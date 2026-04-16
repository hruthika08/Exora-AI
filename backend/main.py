import os
import base64
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import edge_tts
import io
from typing import Optional
import httpx
from urllib.parse import quote as url_quote
from dotenv import load_dotenv
from groq import Groq

# --- NEW SDK ---
from google import genai
from google.genai import types

env_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path=env_path, override=True)

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SYSTEM_INSTRUCTION = (
    "You are Exora AI, a dedicated Telugu assistant. "
    "You MUST respond ONLY in Telugu. Even if the user speaks in English, respond in Telugu. "
    "DO NOT use English words except for technical terms that have no Telugu counterpart. "
    "Your main goal is to promote Telugu conversation."
)

# --- Gemini Setup ---
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
has_gemini = False
gemini_client = None

if GEMINI_API_KEY and GEMINI_API_KEY != "your_gemini_api_key_here":
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)
    has_gemini = True
    print("DEBUG: Gemini client initialized (gemini-1.5-flash)")

# --- Groq Fallback Setup ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
has_groq = False
groq_client = None

if GROQ_API_KEY and GROQ_API_KEY != "your_groq_api_key_here":
    groq_client = Groq(api_key=GROQ_API_KEY)
    has_groq = True
    print("DEBUG: Groq fallback client initialized (llama-3.3-70b-versatile)")


class ChatRequest(BaseModel):
    message: str
    history: Optional[list] = []
    image: Optional[str] = None  # Base64 string


class TTSRequest(BaseModel):
    text: str


class GenerateImageRequest(BaseModel):
    prompt: str


@app.post("/chat")
async def chat(request: ChatRequest):
    print(f"DEBUG: message='{request.message[:50]}...', has_image={request.image is not None}, history_len={len(request.history)}")

    if not has_gemini and not has_groq:
        raise HTTPException(status_code=500, detail="No AI API Key is configured.")

    # ---- Try Gemini first ----
    if has_gemini:
        try:
            contents = []
            for msg in request.history:
                role = "user" if msg.get("role") == "user" else "model"
                content = msg.get("content", "")
                if content:
                    contents.append(types.Content(role=role, parts=[types.Part(text=content)]))

            current_parts = [types.Part(text=request.message)]
            if request.image:
                try:
                    if "," in request.image:
                        base64_string = request.image.split(",")[1]
                        mime_type = request.image.split(";")[0].split(":")[1]
                    else:
                        base64_string = request.image
                        mime_type = "image/jpeg"
                    image_bytes = base64.b64decode(base64_string)
                    current_parts.append(types.Part.from_bytes(data=image_bytes, mime_type=mime_type))
                except Exception as decode_err:
                    print(f"Base64 Decode Error: {decode_err}")

            contents.append(types.Content(role="user", parts=current_parts))

            print(f"DEBUG: Trying Gemini (gemini-1.5-flash) with {len(contents)} items...")
            response = gemini_client.models.generate_content(
                model="gemini-1.5-flash",
                contents=contents,
                config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION)
            )
            reply = response.text
            print("DEBUG: Gemini responded successfully.")
            return {"reply": reply, "source": "gemini"}

        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "quota" in error_str.lower():
                print(f"Gemini quota exceeded — falling back to Groq. Error: {error_str[:120]}")
            else:
                print(f"Gemini Error (non-quota) — falling back to Groq. Error: {error_str[:120]}")

    # ---- Groq Fallback ----
    if has_groq:
        try:
            groq_messages = [{"role": "system", "content": SYSTEM_INSTRUCTION}]
            for msg in request.history:
                role = msg.get("role", "user")
                content = msg.get("content", "")
                if content:
                    groq_messages.append({"role": role if role in ["user", "assistant"] else "user", "content": content})
            groq_messages.append({"role": "user", "content": request.message})

            print("DEBUG: Groq fallback activated (llama-3.3-70b-versatile)...")
            completion = groq_client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=groq_messages,
                temperature=0.7,
                max_tokens=1024,
            )
            reply = completion.choices[0].message.content
            print("DEBUG: Groq responded successfully.")
            return {"reply": reply, "source": "groq"}

        except Exception as e:
            print(f"Groq Error: {e}")
            raise HTTPException(status_code=500, detail=f"Both Gemini and Groq failed: {str(e)}")

    raise HTTPException(status_code=500, detail="No available AI backend.")


@app.post("/tts")
async def text_to_speech(request: TTSRequest):
    if not request.text:
        raise HTTPException(status_code=400, detail="Text is required")
    try:
        voice = "te-IN-ShrutiNeural"
        communicate = edge_tts.Communicate(request.text, voice)

        async def audio_generator():
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    yield chunk["data"]

        return StreamingResponse(audio_generator(), media_type="audio/mpeg")
    except Exception as e:
        print(f"TTS Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/generate-image")
async def generate_image(request: GenerateImageRequest):
    if not request.prompt:
        raise HTTPException(status_code=400, detail="Prompt is required")

    import asyncio
    encoded_prompt = url_quote(request.prompt)
    last_error = None

    # Retry up to 3 times with different seeds to handle Pollinations rate limits
    for attempt in range(3):
        try:
            seed = int.from_bytes(os.urandom(4), "big")
            image_url = (
                f"https://image.pollinations.ai/prompt/{encoded_prompt}"
                f"?seed={seed}&width=1024&height=1024&nologo=true&model=flux"
            )
            print(f"DEBUG: Image gen attempt {attempt + 1}, seed={seed}")

            async with httpx.AsyncClient(timeout=90.0, follow_redirects=True) as client:
                response = await client.get(image_url)

            if response.status_code == 200 and len(response.content) > 1000:
                image_b64 = base64.b64encode(response.content).decode("utf-8")
                print(f"DEBUG: Image generated successfully on attempt {attempt + 1}")
                return {"image": f"data:image/jpeg;base64,{image_b64}"}
            else:
                last_error = f"Bad response: status={response.status_code}, size={len(response.content)}"
                print(f"DEBUG: Attempt {attempt + 1} failed — {last_error}")

        except Exception as e:
            last_error = str(e)
            print(f"DEBUG: Attempt {attempt + 1} exception — {last_error}")

        # Wait before retrying (1s, 2s)
        if attempt < 2:
            await asyncio.sleep(attempt + 1)

    print(f"Image Gen Error after 3 attempts: {last_error}")
    raise HTTPException(status_code=500, detail=f"Image generation failed after 3 attempts: {last_error}")


@app.get("/health")
async def health():
    return {"status": "ok", "gemini": has_gemini, "groq": has_groq}


# Mount Frontend
frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_path):
    app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

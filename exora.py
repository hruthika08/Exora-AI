import os
import speech_recognition as sr
import google.generativeai as genai
from gtts import gTTS
import playsound
from dotenv import load_dotenv

# Load API Key from backend/.env
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "backend", ".env"))

SYSTEM_INSTRUCTION = (
    "You are a helpful, friendly AI assistant. "
    "You MUST ALWAYS respond in natural Telugu. "
    "Keep responses concise and conversational. Do not use English."
)

def speak(text):
    """Convert text to speech and play it."""
    print(f"Assistant: {text}")
    try:
        tts = gTTS(text=text, lang='te')
        filename = "response.mp3"
        tts.save(filename)
        playsound.playsound(filename)
        os.remove(filename)
    except Exception as e:
        print(f"Error in TTS: {e}")

def listen():
    """Listen for user voice and convert to text."""
    r = sr.Recognizer()
    with sr.Microphone() as source:
        print("\nListening (మాట్లాడండి)...")
        r.pause_threshold = 1
        audio = r.listen(source)

    try:
        print("Recognizing (గుర్తిస్తున్నాను)...")
        query = r.recognize_google(audio, language='te-IN')
        print(f"User: {query}")
        return query
    except Exception:
        print("Could not understand. Please try again.")
        return None

def main():
    print("=== EXORA AI: Telugu Voice Assistant ===")
    print("Press Ctrl+C to exit.")

    api_key = os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        print("Error: GEMINI_API_KEY not found or is invalid in .env file.")
        return

    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name='gemini-2.5-flash',
        system_instruction=SYSTEM_INSTRUCTION
    )
    
    chat_session = model.start_chat(history=[])

    while True:
        user_input = listen()
        if not user_input:
            continue

        try:
            response = chat_session.send_message(user_input)
            reply = response.text
            speak(reply)

        except Exception as e:
            print(f"Error calling Gemini: {e}")

if __name__ == "__main__":
    main()

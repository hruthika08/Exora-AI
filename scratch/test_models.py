import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend", ".env"))
api_key = os.getenv("GEMINI_API_KEY")
genai.configure(api_key=api_key)

models = ["gemini-2.0-flash", "gemini-2.5-flash", "gemini-flash-latest", "gemini-1.5-flash", "gemini-3.1-flash-lite-preview"]

for m_name in models:
    print(f"Testing {m_name}...")
    try:
        model = genai.GenerativeModel(m_name)
        response = model.generate_content("Say test")
        print(f"  Success: {response.text}")
    except Exception as e:
        print(f"  Error: {e}")

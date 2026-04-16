import subprocess
import time
import webbrowser
import os
import sys
import urllib.request

def wait_for_server(url, timeout=30):
    """Poll the server health endpoint until it responds or timeout."""
    print("Waiting for server to be ready...", flush=True)
    start = time.time()
    while time.time() - start < timeout:
        try:
            with urllib.request.urlopen(url, timeout=2) as resp:
                if resp.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(0.5)
    return False

def run_backend():
    print("Starting Exora AI Backend...", flush=True)
    backend_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend")
    env_file = os.path.join(backend_dir, ".env")
    if not os.path.exists(env_file):
        with open(env_file, "w") as f:
            f.write("GEMINI_API_KEY=your_gemini_api_key_here\n")
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000", "--reload"],
        cwd=backend_dir
    )

def open_frontend():
    print("Opening Exora AI Frontend...", flush=True)
    webbrowser.open("http://127.0.0.1:8000")

if __name__ == "__main__":
    try:
        backend_process = run_backend()
        ready = wait_for_server("http://127.0.0.1:8000/health")
        if ready:
            print("Server is ready!", flush=True)
            open_frontend()
            print("\nExora AI is running! Press Ctrl+C to stop.", flush=True)
        else:
            print("Server did not start in time. Check backend logs.", flush=True)
        backend_process.wait()
    except KeyboardInterrupt:
        print("\nShutting down Exora AI...", flush=True)
        backend_process.terminate()

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const API_URL = ''; // Relative path for unified hosting
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let chatHistory = [];
let currentSessionId = null;
let isSpeaking = false;
let recognition;
let synth = window.speechSynthesis;
let currentAudio = null; // Backend TTS Audio object
let speechQueue = [];    // Queue for chunked playback
let isQueueActive = false;

// Pre-load voices for better reliability
if (synth && synth.onvoiceschanged !== undefined) {
    synth.onvoiceschanged = () => {
        const voices = synth.getVoices();
        console.log(`Detected ${voices.length} voices. Telugu voices:`, 
            voices.filter(v => v.lang.startsWith('te')).map(v => v.name));
    };
}
let selectedImageData = null;

// DOM Elements
const messagesContainer = document.getElementById('messages');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const plusBtn = document.getElementById('plus-btn');
const optionsMenu = document.getElementById('options-menu');
const uploadBtn = document.getElementById('upload-btn');
const takePhotoBtn = document.getElementById('take-photo-btn');
const genImageBtn = document.getElementById('gen-image-btn');
const cameraInput = document.getElementById('camera-input');

const cameraModal = document.getElementById('camera-modal');
const closeCamera = document.getElementById('close-camera');
const cameraFeed = document.getElementById('camera-feed');
const captureBtn = document.getElementById('capture-btn');
const cameraLoading = document.getElementById('camera-loading');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image');
const micIcon = document.getElementById('mic-icon');
const micBtn = document.getElementById('mic-btn');
const orbContainer = document.getElementById('orb-container');
const orb = document.getElementById('orb');
const orbInner = document.getElementById('orb-inner');
const stopBtn = document.getElementById('stop-btn');
const chatContainer = document.getElementById('chat-container');
const bodyContent = document.getElementById('body-content');
const logoutBtn = document.getElementById('logout-btn');
const userNameEl = document.getElementById('user-name');
const userAvatarEl = document.getElementById('user-avatar');
const sessionListEl = document.getElementById('session-list');
const newChatBtn = document.getElementById('new-chat-btn');
const sidebar = document.getElementById('sidebar');
const sidebarToggle = document.getElementById('sidebar-toggle');
const sidebarClose = document.getElementById('sidebar-close');
const welcomeScreen = document.getElementById('welcome-screen');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastIcon = document.getElementById('toast-icon');

// --- Initialization & Session Management ---

// Toast Helper
function showToast(message, type = 'info') {
    if (!toast) return;
    toastMessage.textContent = message;
    
    // Set icon based on type
    if (type === 'success') toastIcon.setAttribute('data-lucide', 'check-circle');
    else if (type === 'error') toastIcon.setAttribute('data-lucide', 'alert-circle');
    else toastIcon.setAttribute('data-lucide', 'info');
    
    if (window.initLucide) window.initLucide();
    
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

async function checkSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    
    if (error || !session) {
        window.location.href = 'auth.html';
        return;
    }

    const user = session.user;
    const fullName = user.user_metadata?.full_name || user.email.split('@')[0];
    userNameEl.textContent = fullName;
    userAvatarEl.textContent = fullName.charAt(0).toUpperCase();
    
    await loadSessions();
    bodyContent.classList.remove('opacity-0');
    bodyContent.classList.add('opacity-100');
    if (window.initLucide) window.initLucide();
}

async function loadSessions() {
    const { data, error } = await supabase
        .from('sessions')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading sessions:', error);
        return;
    }

    // Clear existing list but keep the "Recents" header
    const header = sessionListEl.querySelector('div');
    sessionListEl.innerHTML = '';
    sessionListEl.appendChild(header);

    data.forEach(session => {
        const div = document.createElement('div');
        div.className = `session-item group ${currentSessionId === session.id ? 'active' : ''}`;
        div.innerHTML = `
            <i data-lucide="message-square" class="w-4 h-4"></i>
            <span class="session-title">${session.title}</span>
            <div class="session-actions">
                <button class="action-btn share" title="Share Chat">
                    <i data-lucide="share-2" class="w-3.5 h-3.5"></i>
                </button>
                <button class="action-btn delete" title="Delete Chat">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            </div>
        `;
        div.onclick = (e) => {
            // Check if a button was clicked
            if (e.target.closest('.action-btn')) return;
            switchToSession(session.id);
        };

        // Add event listeners for actions
        const shareBtn = div.querySelector('.share');
        const deleteBtn = div.querySelector('.delete');

        shareBtn.onclick = (e) => {
            e.stopPropagation();
            shareSession(session.id);
        };

        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            deleteSession(session.id);
        };

        sessionListEl.appendChild(div);
    });
    if (window.initLucide) window.initLucide();
}

async function deleteSession(sessionId) {
    if (!confirm('Are you sure you want to delete this chat?')) return;

    const { error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', sessionId);

    if (error) {
        console.error('Error deleting session:', error);
        showToast('Failed to delete session', 'error');
        return;
    }

    showToast('Conversation deleted', 'info');

    if (currentSessionId === sessionId) {
        startNewChat();
    } else {
        loadSessions();
    }
}

async function shareSession(sessionId) {
    const shareUrl = `${window.location.origin}/chat?id=${sessionId}`;
    try {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Link copied to clipboard!', 'success');
    } catch (err) {
        console.error('Failed to copy:', err);
        showToast('Failed to copy link', 'error');
    }
}

async function switchToSession(sessionId) {
    if (currentSessionId === sessionId) return;
    currentSessionId = sessionId;
    
    welcomeScreen.classList.add('hidden');
    messagesContainer.innerHTML = '';
    chatHistory = [];
    
    const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error loading messages:', error);
        return;
    }

    data.forEach(msg => {
        addMessage(msg.content, msg.role === 'user');
        chatHistory.push({ role: msg.role, content: msg.content });
    });
    
    if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
    loadSessions(); // Update active state in sidebar
    if (window.innerWidth < 768) sidebar.classList.remove('open');
}

function startNewChat() {
    currentSessionId = null;
    chatHistory = [];
    messagesContainer.innerHTML = '';
    welcomeScreen.classList.remove('hidden');
    loadSessions();
    if (window.innerWidth < 768) sidebar.classList.remove('open');
}

// --- Chat Logic ---

function addMessage(text, isUser = false, imageUrl = null) {
    const wrapper = document.createElement('div');
    wrapper.className = isUser ? 'flex flex-col items-end w-full mb-6' : 'flex flex-col items-start w-full mb-6';

    if (!isUser && text) { 
        const speakBtn = document.createElement('button');
        speakBtn.className = 'speak-btn animate-fade-in';
        speakBtn.innerHTML = `<i data-lucide="volume-2"></i> వినండి (Speak)`;
        speakBtn.onclick = () => speak(text);
        wrapper.appendChild(speakBtn);
    }

    const msgDiv = document.createElement('div');
    msgDiv.className = isUser ? 'message-user' : 'message-ai animate-fade-in';
    
    // If there's an image, add it first
    if (imageUrl) {
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'max-w-xs rounded-lg mb-2 border border-white/10 shadow-lg';
        msgDiv.appendChild(img);
    }

    const textDiv = document.createElement('div');
    if (isUser) {
        textDiv.textContent = text;
    } else {
        if (typeof marked !== 'undefined') {
            textDiv.innerHTML = marked.parse(text);
        } else {
            textDiv.textContent = text;
        }
    }
    msgDiv.appendChild(textDiv);
    
    wrapper.appendChild(msgDiv);
    messagesContainer.appendChild(wrapper);
    chatContainer.scrollTop = chatContainer.scrollHeight;
    welcomeScreen.classList.add('hidden');
    
    // Initialize icons for the newly added button
    if (window.initLucide) window.initLucide();
}

async function saveMessageToSupabase(role, content) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    // Create session if it doesn't exist (first message)
    if (!currentSessionId) {
        const { data: newSession, error: sError } = await supabase
            .from('sessions')
            .insert([{ 
                user_id: user.id, 
                title: content.substring(0, 30) + (content.length > 30 ? '...' : '') 
            }])
            .select()
            .single();
        
        if (sError) {
            console.error('Error creating session:', sError);
            return;
        }
        currentSessionId = newSession.id;
        loadSessions();
    }

    const { error } = await supabase
        .from('messages')
        .insert([{ 
            user_id: user.id, 
            session_id: currentSessionId,
            role, 
            content 
        }]);

    if (error) console.error('Error saving message:', error);
}

async function sendMessage() {
    const message = userInput.value.trim();
    if (!message && !selectedImageData) return;
    
    const lowerMsg = message.toLowerCase();
    const isImageRequest = 
        lowerMsg.startsWith('create image') || 
        lowerMsg.startsWith('create an image') || 
        lowerMsg.startsWith('create a image') || 
        lowerMsg.startsWith('generate image') || 
        lowerMsg.startsWith('generate an image') || 
        lowerMsg.startsWith('generate a image') ||
        lowerMsg.startsWith('make an image') ||
        lowerMsg.startsWith('make a image');
        
    if (isImageRequest) {
        generateImage(message);
        return;
    }
    
    const currentImage = selectedImageData;
    userInput.value = '';
    clearImagePreview();
    
    addMessage(message || (currentImage ? "Image uploaded" : ""), true, currentImage);
    saveMessageToSupabase('user', message || "Sent an image");

    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message-ai py-4';
    loadingDiv.id = 'loading';
    loadingDiv.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    messagesContainer.appendChild(loadingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const response = await fetch(`${API_URL}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message || "Describe this image", 
                history: chatHistory,
                image: currentImage
            })
        });

        if (!response.ok) throw new Error('Server error');

        const data = await response.json();
        messagesContainer.removeChild(loadingDiv);

        if (data.reply) {
            saveMessageToSupabase('assistant', data.reply);
            chatHistory.push({ role: 'user', content: message || "Looked at an image" });
            chatHistory.push({ role: 'assistant', content: data.reply });
            if (chatHistory.length > 10) chatHistory = chatHistory.slice(-10);
            addMessage(data.reply, false);
        }
    } catch (error) {
        console.error('Error:', error);
        if (messagesContainer.contains(loadingDiv)) messagesContainer.removeChild(loadingDiv);
        addMessage(`క్షమించండి, ఏదో తేడా కొట్టింది! మళ్ళీ ట్రై చేయండి...`, false);
    }
}

// --- Image Handling Helpers ---

function handleImageSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        selectedImageData = event.target.result;
        imagePreview.src = selectedImageData;
        imagePreviewContainer.classList.remove('hidden');
        userInput.focus();
    };
    reader.readAsDataURL(file);
}

function clearImagePreview() {
    selectedImageData = null;
    imagePreview.src = '';
    imagePreviewContainer.classList.add('hidden');
    cameraInput.value = '';
}

// --- Speech & UI Helpers ---

function cleanTextForSpeech(text) {
    if (!text) return "";
    return text
        .replace(/\*\*(.*?)\*\*/g, '$1') 
        .replace(/\*(.*?)\*/g, '$1')     
        .replace(/```[\s\S]*?```/g, 'కొత్త కోడ్ బ్లాక్') 
        .replace(/`([^`]+)`/g, '$1')    
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') 
        .trim();
}

async function speak(text) {
    if (!text) return;
    
    // Stop current speech and clear queue
    await stopSpeech();
    
    const cleanedText = cleanTextForSpeech(text);
    
    // Split by common Telugu sentence endings followed by space
    // Using a simpler split to avoid complex regex issues on different devices
    speechQueue = cleanedText.split(/[।\.!\?\n]+/).map(s => s.trim()).filter(s => s.length > 0);
    
    if (speechQueue.length === 0) return;
    
    isQueueActive = true;
    playNextChunk();
}

async function playNextChunk() {
    if (!isQueueActive || speechQueue.length === 0) {
        if (speechQueue.length === 0) {
            isQueueActive = false;
            stopOrbAnimation();
            const indicator = document.getElementById('speech-indicator');
            if (indicator) indicator.remove();
        }
        return;
    }

    const chunk = speechQueue.shift();
    
    try {
        const response = await fetch(`${API_URL}/tts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: chunk })
        });

        if (!response.ok) throw new Error('TTS Server Error');

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        
        currentAudio = new Audio(url);
        
        currentAudio.onplay = () => {
            isSpeaking = true; 
            startOrbAnimation(); 
            
            // Show indicator if it's the first chunk
            if (!document.getElementById('speech-indicator')) {
                const activeSpeechToast = document.createElement('div');
                activeSpeechToast.id = 'speech-indicator';
                activeSpeechToast.className = 'fixed top-4 left-1/2 -translate-x-1/2 glass px-4 py-2 rounded-full text-xs text-blue-400 z-[100] animate-pulse';
                activeSpeechToast.innerHTML = '🔊 వినిపిస్తోంది, వినండి... (Listening...)';
                document.body.appendChild(activeSpeechToast);
            }
        };

        currentAudio.onended = () => { 
            URL.revokeObjectURL(url);
            currentAudio = null;
            playNextChunk(); // Continue to next sentence
        };

        currentAudio.onerror = (e) => {
            console.error('Audio playback error:', e);
            URL.revokeObjectURL(url);
            playNextChunk(); // Try next one anyway
        };

        await currentAudio.play();
    } catch (error) {
        console.error('TTS Error for chunk:', error);
        playNextChunk(); 
    }
}

async function stopSpeech() {
    isQueueActive = false;
    speechQueue = [];
    if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
    }
    if (synth) synth.cancel();
    stopOrbAnimation();
    const indicator = document.getElementById('speech-indicator');
    if (indicator) indicator.remove();
}

function startOrbAnimation() {
    orbContainer.classList.remove('opacity-0');
    orbContainer.classList.add('opacity-100');
    orb.classList.add('speaking');
    stopBtn.classList.remove('hidden');
    animateOrb();
}

function stopOrbAnimation() {
    orbContainer.classList.replace('opacity-100', 'opacity-0');
    orb.classList.remove('speaking');
    stopBtn.classList.add('hidden');
    isSpeaking = false;
}

function animateOrb() {
    if (!isSpeaking) return;
    const bars = document.querySelectorAll('.waveform-bar');
    bars.forEach((bar) => {
        const height = 20 + Math.random() * 60;
        bar.style.height = `${height}px`;
    });
    orb.style.transform = `scale(${1 + Math.random() * 0.1})`;
    requestAnimationFrame(animateOrb);
}

// --- Event Listeners ---

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendMessage(); });
newChatBtn.addEventListener('click', startNewChat);

// --- Input Options & Menu ---
plusBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    optionsMenu.classList.toggle('hidden');
});

document.addEventListener('click', () => {
    optionsMenu.classList.add('hidden');
});

uploadBtn.addEventListener('click', () => cameraInput.click());

takePhotoBtn.addEventListener('click', openCamera);

// Camera Functions
let stream = null;

async function openCamera() {
    cameraModal.classList.remove('hidden');
    cameraLoading.classList.remove('hidden');
    try {
        stream = await navigator.mediaDevices.getUserMedia({ 
            video: { facingMode: 'environment' } 
        });
        cameraFeed.srcObject = stream;
        cameraLoading.classList.add('hidden');
    } catch (err) {
        console.error("Camera Error:", err);
        showToast("Camera permission denied", "error");
        closeCameraModal();
    }
}

function closeCameraModal() {
    cameraModal.classList.add('hidden');
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
    }
}

closeCamera.addEventListener('click', closeCameraModal);

captureBtn.addEventListener('click', () => {
    const canvas = document.createElement('canvas');
    canvas.width = cameraFeed.videoWidth;
    canvas.height = cameraFeed.videoHeight;
    canvas.getContext('2d').drawImage(cameraFeed, 0, 0);
    const dataUrl = canvas.toDataURL('image/jpeg');
    
    selectedImageData = dataUrl;
    imagePreview.src = dataUrl;
    imagePreviewContainer.classList.remove('hidden');
    
    closeCameraModal();
    showToast("Photo captured", "success");
});

// AI Image Generation
let isGeneratingImage = false; // Guard to prevent concurrent image generation
genImageBtn.addEventListener('click', generateImage);

async function generateImage(promptOverride = null) {
    // If the event was passed (from click), promptOverride will be an Event object, so check if it's a string
    const prompt = (typeof promptOverride === 'string') ? promptOverride : userInput.value.trim();
    if (!prompt) {
        showToast("Please enter a prompt first", "info");
        return;
    }

    // Prevent concurrent generation
    if (isGeneratingImage) {
        showToast("Please wait, image is being generated...", "info");
        return;
    }
    isGeneratingImage = true;

    showToast("Generating image...", "info");
    genImageBtn.disabled = true;
    const originalContent = genImageBtn.innerHTML;
    genImageBtn.innerHTML = `<div class="loading-spinner scale-50"></div> Generating...`;

    // Clear input early so user can type the next prompt
    userInput.value = '';

    // Show a loading message in the chat with a unique ID
    addMessage(prompt, true);
    const loadingId = `img-loading-${Date.now()}`;
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message-ai py-4';
    loadingDiv.id = loadingId;
    loadingDiv.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    messagesContainer.appendChild(loadingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;

    try {
        const response = await fetch(`${API_URL}/generate-image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt })
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.detail || `Server error ${response.status}`);
        }

        const data = await response.json();

        // Remove loading indicator
        if (messagesContainer.contains(loadingDiv)) messagesContainer.removeChild(loadingDiv);

        if (!data.image) throw new Error("No image data returned");

        // Display the generated image as an AI message with the image
        addMessage(`అదిరింది బాస్! ఇదిగో మీరు అడిగిన చిత్రం:`, false, data.image);
        saveMessageToSupabase('assistant', `[AI Generated Image for: ${prompt}]`);
        
    } catch (err) {
        console.error("Image Gen Error:", err);
        if (messagesContainer.contains(loadingDiv)) messagesContainer.removeChild(loadingDiv);
        showToast(`Image generation failed: ${err.message}`, "error");
        addMessage("క్షమించండి, చిత్రం చేయడంలో తేడా కొట్టింది. మళ్ళీ ట్రై చేయండి.", false);
    } finally {
        // Always reset state so next generation works
        isGeneratingImage = false;
        genImageBtn.disabled = false;
        genImageBtn.innerHTML = originalContent;
        if (window.initLucide) window.initLucide();
    }
}

cameraInput.addEventListener('change', handleImageSelect);
removeImageBtn.addEventListener('click', clearImagePreview);

// Drag and Drop support
window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('drag-active');
});

window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-active');
});

window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('drag-active');
    const files = e.dataTransfer.files;
    if (files && files[0]) {
        handleImageSelect({ target: { files: [files[0]] } });
    }
});

// Paste support
window.addEventListener('paste', (e) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            handleImageSelect({ target: { files: [file] } });
            break;
        }
    }
});

sidebarToggle.addEventListener('click', () => sidebar.classList.add('open'));
sidebarClose.addEventListener('click', () => sidebar.classList.remove('open'));

logoutBtn.addEventListener('click', async () => {
    await supabase.auth.signOut();
    window.location.href = 'auth.html';
});

if (window.SpeechRecognition || window.webkitSpeechRecognition) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.lang = 'te-IN';
    recognition.onstart = () => micBtn.classList.add('mic-active');
    recognition.onresult = (e) => { userInput.value = e.results[0][0].transcript; sendMessage(); };
    recognition.onend = () => micBtn.classList.remove('mic-active');
    micBtn.addEventListener('click', () => recognition.start());
}

stopBtn.addEventListener('click', stopSpeech);

// Start
checkSession();

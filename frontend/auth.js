import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Initialize Supabase Client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// DOM Elements
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');
const toastIcon = document.getElementById('toast-icon');

// Auth View Persistence
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
        window.location.href = 'index.html';
    }
});

// Toast Helper
function showToast(message, type = 'info') {
    toastMessage.textContent = message;
    
    // Set icon based on type
    if (type === 'success') toastIcon.setAttribute('data-lucide', 'check-circle');
    else if (type === 'error') toastIcon.setAttribute('data-lucide', 'alert-circle');
    else toastIcon.setAttribute('data-lucide', 'info');
    
    window.lucide.createIcons();
    
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 4000);
}

// Login Handler
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btnText = document.getElementById('login-btn-text');
    const spinner = document.getElementById('login-spinner');

    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        
        showToast('Login successful! Redirecting...', 'success');
        setTimeout(() => {
            window.location.href = 'index.html';
        }, 1500);
    } catch (error) {
        showToast(error.message, 'error');
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
});

// Signup Handler
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const isEmail = !document.getElementById('email-fields').classList.contains('hidden');
    const btnText = document.getElementById('signup-btn-text');
    const spinner = document.getElementById('signup-spinner');

    btnText.classList.add('hidden');
    spinner.classList.remove('hidden');

    try {
        if (isEmail) {
            const email = document.getElementById('signup-email').value;
            const password = document.getElementById('signup-password').value;
            const fullName = document.getElementById('signup-name').value;

            const { data, error } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: { full_name: fullName }
                }
            });

            if (error) throw error;
            
            if (data.user && data.session) {
                showToast('Account created successfully!', 'success');
                setTimeout(() => window.location.href = 'index.html', 1500);
            } else {
                showToast('Success! Please check your email for confirmation.', 'success');
                btnText.classList.remove('hidden');
                spinner.classList.add('hidden');
            }
        } else {
            const phone = document.getElementById('signup-phone').value;
            const { error } = await supabase.auth.signInWithOtp({ phone });
            if (error) throw error;
            showToast('OTP sent to your phone!', 'success');
            btnText.classList.remove('hidden');
            spinner.classList.add('hidden');
        }
    } catch (error) {
        showToast(error.message, 'error');
        btnText.classList.remove('hidden');
        spinner.classList.add('hidden');
    }
});

// Social Login
window.socialLogin = async (provider) => {
    try {
        const { error } = await supabase.auth.signInWithOAuth({
            provider,
            options: {
                redirectTo: window.location.origin + '/index.html'
            }
        });
        if (error) throw error;
    } catch (error) {
        showToast(error.message, 'error');
    }
};

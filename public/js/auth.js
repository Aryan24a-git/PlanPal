/**
 * PlanPal Authentication Module
 * REQ-001, SEC-001: Register, Sign In, Sign Out, and Current User State.
 */
import { apiRequest, setToken, clearToken } from './api.js';
import { announce, showToast } from './dom.js';

let currentUser = null;

export function getCurrentUser() {
  return currentUser;
}

export function setCurrentUser(user) {
  currentUser = user;
}

export function initAuth({ onLoginSuccess, onLogout }) {
  const loginForm = document.getElementById('login-form');
  const registerForm = document.getElementById('register-form');
  const switchToRegisterBtn = document.getElementById('switch-to-register');
  const switchToLoginBtn = document.getElementById('switch-to-login');
  const logoutBtn = document.getElementById('btn-logout');

  switchToRegisterBtn?.addEventListener('click', () => {
    loginForm.classList.add('hidden');
    registerForm.classList.remove('hidden');
  });

  switchToLoginBtn?.addEventListener('click', () => {
    registerForm.classList.add('hidden');
    loginForm.classList.remove('hidden');
  });

  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;

    try {
      const res = await apiRequest('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(res.token);
      setCurrentUser(res.user);
      announce(`Welcome back, ${res.user.name}`);
      showToast(`Welcome back, ${res.user.name}!`, 'success');
      onLoginSuccess(res.user);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  registerForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('register-name').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value;

    try {
      const res = await apiRequest('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name }),
      });
      setToken(res.token);
      setCurrentUser(res.user);
      announce(`Account created! Welcome, ${res.user.name}`);
      showToast('Account created successfully!', 'success');
      onLoginSuccess(res.user);
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  logoutBtn?.addEventListener('click', () => {
    clearToken();
    setCurrentUser(null);
    announce('Signed out successfully');
    showToast('Signed out', 'info');
    onLogout();
  });
}

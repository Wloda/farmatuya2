/* ═══════════════════════════════════════════════════════════════
   BW² — Auth Module
   Client-side authentication with SHA-256 password hashing
   ═══════════════════════════════════════════════════════════════ */

const AUTH_USERS_KEY  = 'bw2_users';
const AUTH_SESSION_KEY = 'bw2_session';
const SESSION_DAYS    = 30;

/* ── Crypto helpers ── */
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2,'0')).join('');
}

function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2,'0')).join('');
}

function generateUID() {
  return 'u_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2,8);
}

/* ── Storage helpers ── */
function getUsers() {
  try { return JSON.parse(localStorage.getItem(AUTH_USERS_KEY)) || []; }
  catch(e) { return []; }
}

function saveUsers(users) {
  localStorage.setItem(AUTH_USERS_KEY, JSON.stringify(users));
}

function getSession() {
  try { return JSON.parse(localStorage.getItem(AUTH_SESSION_KEY)) || null; }
  catch(e) { return null; }
}

function saveSession(session) {
  localStorage.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(AUTH_SESSION_KEY);
}

/* ── Public API ── */

/**
 * Register a new user
 * @returns {Object} { success, error?, user? }
 */
async function registerUser(email, password, firstName, lastName) {
  email = (email || '').trim().toLowerCase();
  firstName = (firstName || '').trim();
  lastName = (lastName || '').trim();

  // Validations
  if (!email) return { success: false, error: 'Ingresa tu correo electrónico' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { success: false, error: 'Correo electrónico inválido' };
  if (!password || password.length < 6) return { success: false, error: 'La contraseña debe tener al menos 6 caracteres' };
  if (!firstName) return { success: false, error: 'Ingresa tu nombre' };

  const users = getUsers();
  if (users.find(u => u.email === email)) {
    return { success: false, error: 'Ya existe una cuenta con este correo' };
  }

  const hashedPwd = await hashPassword(password);
  const user = {
    id: generateUID(),
    email,
    password: hashedPwd,
    firstName,
    lastName,
    photo: null,
    role: 'admin',
    createdAt: new Date().toISOString()
  };

  users.push(user);
  saveUsers(users);

  // Auto-login
  const token = generateToken();
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  saveSession({ token, userId: user.id, expiry });

  // Migrate existing profile data to this user
  const oldProfile = localStorage.getItem('bw2_user_profile');
  if (oldProfile) {
    try {
      const p = JSON.parse(oldProfile);
      if (p.photo) user.photo = p.photo;
      saveUsers(users);
    } catch(e) {}
  }

  return { success: true, user: sanitizeUser(user) };
}

/**
 * Login with email + password
 * @returns {Object} { success, error?, user? }
 */
async function loginUser(email, password) {
  email = (email || '').trim().toLowerCase();
  if (!email || !password) return { success: false, error: 'Ingresa tu correo y contraseña' };

  const users = getUsers();
  const user = users.find(u => u.email === email);
  if (!user) return { success: false, error: 'No existe una cuenta con este correo' };

  const hashedAttempt = await hashPassword(password);
  if (hashedAttempt !== user.password) {
    return { success: false, error: 'Contraseña incorrecta' };
  }

  const token = generateToken();
  const expiry = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  saveSession({ token, userId: user.id, expiry });

  return { success: true, user: sanitizeUser(user) };
}

/**
 * Logout current session
 */
function logoutUser() {
  clearSession();
}

/**
 * Get current authenticated user (or null)
 */
function getCurrentUser() {
  const session = getSession();
  if (!session) return null;
  if (Date.now() > session.expiry) { clearSession(); return null; }

  const users = getUsers();
  const user = users.find(u => u.id === session.userId);
  return user ? sanitizeUser(user) : null;
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
  return getCurrentUser() !== null;
}

/**
 * Update user profile data
 */
function updateUserProfile(data) {
  const session = getSession();
  if (!session) return false;

  const users = getUsers();
  const idx = users.findIndex(u => u.id === session.userId);
  if (idx === -1) return false;

  if (data.firstName !== undefined) users[idx].firstName = data.firstName.trim();
  if (data.lastName !== undefined) users[idx].lastName = data.lastName.trim();
  if (data.photo !== undefined) users[idx].photo = data.photo;

  saveUsers(users);

  // Sync to old profile format for backward compat
  localStorage.setItem('bw2_user_profile', JSON.stringify({
    firstName: users[idx].firstName,
    lastName: users[idx].lastName,
    photo: users[idx].photo
  }));

  return true;
}

/**
 * Change password
 */
async function changePassword(currentPwd, newPwd) {
  const session = getSession();
  if (!session) return { success: false, error: 'No hay sesión activa' };

  const users = getUsers();
  const user = users.find(u => u.id === session.userId);
  if (!user) return { success: false, error: 'Usuario no encontrado' };

  const hashedCurrent = await hashPassword(currentPwd);
  if (hashedCurrent !== user.password) {
    return { success: false, error: 'Contraseña actual incorrecta' };
  }

  if (!newPwd || newPwd.length < 6) {
    return { success: false, error: 'La nueva contraseña debe tener al menos 6 caracteres' };
  }

  user.password = await hashPassword(newPwd);
  saveUsers(users);
  return { success: true };
}

/**
 * Strip sensitive fields before returning user
 */
function sanitizeUser(user) {
  const { password, ...safe } = user;
  return safe;
}

/* ── Exports ── */
export {
  registerUser,
  loginUser,
  logoutUser,
  getCurrentUser,
  isAuthenticated,
  updateUserProfile,
  changePassword
};

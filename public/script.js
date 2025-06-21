const socket = io();
let currentRecipient = null;
let isLibrarian = false;
let myName = '';
let myId = socket.id;

// Registration elements
const registrationDiv = document.getElementById('registration');
const chatDiv = document.getElementById('chat');
const registerButton = document.getElementById('registerButton');
const logoutButton = document.getElementById('logoutButton')

// Sidebar elements
const userAvatar = document.getElementById('userAvatar');
const sidebarUserName = document.getElementById('sidebarUserName');
const sidebarUserEmail = document.getElementById('sidebarUserEmail');

// Chat area elements
const currentChatAvatar = document.getElementById('currentChatAvatar');
const currentChatName = document.getElementById('currentChatName');
const currentChatStatus = document.getElementById('currentChatStatus');
const messages = document.getElementById('messages');
const onlineUsersList = document.getElementById('onlineUsersList');

// Input elements
const messageInput = document.getElementById('messageInput');
const sendButton = document.getElementById('sendButton');

// Track active chats
const activeChats = new Set();

// Handle registration
registerButton.addEventListener('click', () => {
  const name = document.getElementById('nameInput').value.trim();
  const email = document.getElementById('emailInput').value.trim();
  const emailRegex = /^[^\s@]+@iitgn\.ac\.in$/;

  if (!name || !email) {
    alert('Please enter both name and email');
    return;
  }

  if (!emailRegex.test(email)) {
    alert('Please enter a valid IITGN email address');
    return;
  }

  // Validate librarian email
  isLibrarian = [
    'librarybot1@iitgn.ac.in',
    'librarybot2@iitgn.ac.in',
    'librarybot3@iitgn.ac.in'
  ].includes(email);

  myName = name;

  // Hide Online Patrons section for patrons
  if (!isLibrarian) {
    document.querySelector('.online-users').style.display = 'none';
  }

  // Update sidebar user info
  userAvatar.textContent = name.charAt(0).toUpperCase();
  sidebarUserName.textContent = name;
  sidebarUserEmail.textContent = email;

  // Set chat header for librarians
  if (isLibrarian) {
    currentChatName.textContent = 'Available Patrons';
    currentChatStatus.textContent = 'Select a patron to chat';
  }

  socket.emit('register', {
    isLibrarian: isLibrarian,
    name: name,
    email: email
  });

  // Handle no librarians available
  socket.on('no librarians', () => {
    const messagesDiv = document.getElementById('messages');
    const systemMsg = document.createElement('div');
    systemMsg.className = 'system-message';
    systemMsg.textContent = 'No librarians are currently available. Please try again later.';
    messagesDiv.appendChild(systemMsg);
  });

  socket.on('no available librarians', () => {
    const messagesDiv = document.getElementById('messages');
    const systemMsg = document.createElement('div');
    systemMsg.className = 'system-message';
    systemMsg.innerHTML = `
        Thanks for connecting! A library assistant is currently helping other users. 
        You’re in the queue - we’ll be with you shortly. <br> While you wait, feel free to browse our 
        <a href="https://library.iitgn.ac.in/" target="_blank" class="waiting-link">Library Website</a> or 
        <a href="https://catalog.iitgn.ac.in/" target="_blank" class="waiting-link">Search the Catalogue</a>.
    `;
    messagesDiv.appendChild(systemMsg);
  });

  // Hide registration and show chat
  registrationDiv.style.display = 'none';
  chatDiv.style.display = 'block';
});

logoutButton.addEventListener('click', function () {
  socket.emit('logout');
  socket.disconnect();
  location.reload();
});

// Handle sending messages
function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || !currentRecipient) return;

  socket.emit('private message', {
    to: currentRecipient,
    message: message
  });

  // Display message immediately in our own chat
  addMessage(message, 'sent', myName);
  messageInput.value = '';
}

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// Socket event handlers
socket.on('private message', ({ from, fromName, message, isOwnMessage }) => {
  if (isOwnMessage) return;

  // Play sound for new message
  if (from !== myId) {
    playMessageSound();
  }

  // If this is our first message from someone, set them as current recipient
  if (!currentRecipient && from !== myId) {
    currentRecipient = from;
    addSystemMessage(`Now chatting with ${fromName}`);
    currentChatName.textContent = fromName;
    currentChatAvatar.textContent = fromName.charAt(0).toUpperCase();
    currentChatStatus.textContent = 'Online';

    // Update status to "in chat" (blue)
    if (isLibrarian) {
      updateUserStatus(from, 'in-chat');
    }
  }

  addMessage(message, 'received', fromName);
});

socket.on('chat started', ({ librarianId, librarianName, userId, userName }) => {
  if (isLibrarian) {
    // Librarian view
    currentRecipient = userId;
    addSystemMessage(`You are now chatting with ${userName}`);
    currentChatName.textContent = userName;
    currentChatAvatar.textContent = userName.charAt(0).toUpperCase();
    currentChatStatus.textContent = 'Online';

    // Mark user as in chat (blue)
    updateUserStatus(userId, 'in-chat');
    activeChats.add(userId);
  } else {
    // User view
    currentRecipient = librarianId;
    addSystemMessage(`${librarianName} is now assisting you`);
    currentChatName.textContent = librarianName;
    currentChatAvatar.textContent = librarianName.charAt(0).toUpperCase();
    currentChatStatus.textContent = 'Online';
  }

});

socket.on('chat ended', ({ userId }) => {
  if (isLibrarian) {
    // Mark user as available again (green)
    updateUserStatus(userId, 'available');
    activeChats.delete(userId);
  }
});

socket.on('update user list', (userList) => {
  if (!isLibrarian) return;

  onlineUsersList.innerHTML = ''; // Clear current list

  userList.forEach(user => {
    addUserToOnlineList(user);
  });
});

socket.on('new user', (user) => {
  if (!isLibrarian) return;

  // Play sound for new user (only for librarians)
  playUserSound();

  addUserToOnlineList(user);
});

socket.on('user status changed', ({ userId, status }) => {
  if (!isLibrarian) return; // Only librarians care about status changes

  const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
  if (userElement) {
    const statusElement = userElement.querySelector('.user-status');
    statusElement.className = 'user-status ' + status; // Updates color
  }
});

socket.on('user disconnected', (userId) => {
  if (!isLibrarian) return;

  const userElement = document.querySelector(`.user-item[data-user-id="${userId}"]`);
  if (userElement) {
    // Visual indication before removal
    updateUserStatus(userId, 'offline');

    // Remove after delay
    setTimeout(() => {
      userElement.remove();
      activeChats.delete(userId);

      // If we were chatting with this user, clear the chat
      if (currentRecipient === userId) {
        currentRecipient = null;
        currentChatName.textContent = 'Available Patrons';
        currentChatStatus.textContent = 'Select a patron to chat';
        addSystemMessage('The patron has disconnected.');
      }
    }, 1000);
  }
});

socket.on('system message', (msg) => {
  addSystemMessage(msg);
});

// Helper function to update user status
function updateUserStatus(userId, status) {
  const userElement = document.querySelector(`.user-item[data-user-id="${userId}"] .user-status`);
  if (userElement) {
    // Remove all status classes
    userElement.classList.remove('available', 'in-chat', 'offline');
    // Add the new status class
    userElement.classList.add(status);
  }
}

// Helper function to add users to online list
function addUserToOnlineList(user) {
  if (!isLibrarian) return;

  // Check if user already exists in the list
  if (document.querySelector(`.user-item[data-user-id="${user.userId}"]`)) return;

  const userItem = document.createElement('div');
  userItem.className = 'user-item';
  userItem.dataset.userId = user.userId;
  userItem.innerHTML = `
      <div class="user-status ${user.status || 'available'}"></div>
      <div class="user-avatar-small">${user.userName.charAt(0).toUpperCase()}</div>
      <div>
        <div class="user-name">${user.userName}</div>
        <div class="user-email">${user.userEmail}</div>
      </div>
  `;


  userItem.addEventListener('click', () => {
    // End any previous active chat
    if (currentRecipient) {
      socket.emit('end chat', { userId: currentRecipient });
      updateUserStatus(currentRecipient, 'available');
      activeChats.delete(currentRecipient);
    }

    // Start new chat
    document.querySelectorAll('.user-item').forEach(item => {
      item.classList.remove('active');
    });
    userItem.classList.add('active');
    socket.emit('start chat with user', user.userId);
  });

  onlineUsersList.appendChild(userItem);
}

// Helper functions for adding messages
function addMessage(text, type, senderName) {
  const now = new Date();
  const timeString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.innerHTML = `
    <div class="message-bubble">${text}</div>
    <div class="message-time">${timeString} • ${senderName}</div>
  `;

  messages.appendChild(messageDiv);
  messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
  const systemDiv = document.createElement('div');
  systemDiv.className = 'system-message';
  systemDiv.textContent = text;
  messages.appendChild(systemDiv);
  messages.scrollTop = messages.scrollHeight;
}

// Sound functions
function playMessageSound() {
  const sound = document.getElementById('messageSound');
  sound.currentTime = 0; // Rewind to start
  sound.play().catch(e => console.log("Audio play failed:", e));
}

function playUserSound() {
  const sound = document.getElementById('userSound');
  sound.currentTime = 0; // Rewind to start
  sound.play().catch(e => console.log("Audio play failed:", e));
}
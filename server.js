const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

require('dotenv').config();
const connectDB = require('./db');
const Message = require('./models/Message');
const Session = require('./models/Session');

connectDB();

// Serve static files
app.use(express.static('public'));

// Working hours (9 AM to 5 PM)
const WORKING_HOURS = {
    start: 10,
    end: 20
};

// Store connected users and librarians
const users = {};
const librarians = {};
const activeChats = new Set(); // Track active chats

function isWorkingHours() {
    const now = new Date();
    const hours = now.getHours();
    return hours >= WORKING_HOURS.start && hours < WORKING_HOURS.end;
}

io.on('connection', (socket) => {
    if (!isWorkingHours()) {
        socket.emit('system message', 'Sorry, the chat is only available from 10 AM to 6 PM.');
        socket.disconnect(true);
        return;
    }

    socket.emit('request registration');

    socket.on('register', (data) => {

        // Validate librarian email on server side
        if (data.isLibrarian) {
            const allowedEmails = [
                'librarybot1@iitgn.ac.in',
                'librarybot2@iitgn.ac.in',
                'librarybot3@iitgn.ac.in'
            ];

            if (!allowedEmails.includes(data.email)) {
                socket.emit('system message', 'Error: Only specific library email addresses are allowed for librarians');
                socket.disconnect(true);
                return;
            }
        }

        if (data.isLibrarian) {
            librarians[socket.id] = {
                name: data.name,
                email: data.email,
                socket: socket
            };
            socket.emit('system message', `Welcome, Librarian ${data.name}!`);

            socket.emit('update user list', Object.values(users).map(user => ({
                userId: user.socket.id,
                userName: user.name,
                userEmail: user.email
            })));
        }
        else {
            if (users[socket.id]) {
                delete users[socket.id];
                activeChats.delete(socket.id);
            }

            users[socket.id] = {
                name: data.name,
                email: data.email,
                socket: socket
            };
            socket.emit('system message', `Welcome, ${data.name}! A librarian will be with you shortly.`);

            const newUser = {
                userId: socket.id,
                userName: data.name,
                userEmail: data.email
            };
            io.to(Object.keys(librarians)).emit('new user', newUser);
            const diff = Object.keys(librarians).length - Object.keys(users).length;
            // Notify patron if no librarians available
            if (Object.keys(librarians).length === 0) {
                socket.emit('no librarians');
            }
            else if (diff < 0){
                socket.emit('no available librarians');
            }
        }
    });

    socket.on('private message', async ({ to, message }) => {
        const sender = users[socket.id] || librarians[socket.id];
        if (!sender) return;

        const recipient = users[to] || librarians[to];
        if (!recipient) {
            socket.emit('system message', 'Recipient not found');
            return;
        }

        const sessionId = [socket.id, to].sort().join('_');

        try {
            const newMessage = new Message({
                sessionId,
                from: {
                    id: socket.id,
                    name: sender.name,
                    email: sender.email,
                    role: users[socket.id] ? 'user' : 'librarian'
                },
                to: {
                    id: to,
                    name: recipient.name,
                    email: recipient.email,
                    role: users[to] ? 'user' : 'librarian'
                },
                message
            });

            await newMessage.save();
        } catch (err) {
            console.error('Error saving message:', err);
        }

        recipient.socket.emit('private message', {
            from: socket.id,
            fromName: sender.name,
            message: message
        });

        socket.emit('private message', {
            from: socket.id,
            fromName: "You",
            message: message,
            isOwnMessage: true
        });
    });

    socket.on('start chat with user', async (userId) => {
        const librarian = librarians[socket.id];
        if (!librarian) return;

        const user = users[userId];
        if (!user) return;

        activeChats.add(userId);
        // Notify all librarians about the status change
        Object.values(librarians).forEach(lib => {
            lib.socket.emit('user status changed', {
                userId: userId,
                status: 'in-chat',
            });
        });

        user.socket.emit('chat started', {
            librarianId: socket.id,
            librarianName: librarian.name
        });

        librarian.socket.emit('chat started', {
            userId: userId,
            userName: user.name
        });

        const sessionId = [userId, socket.id].sort().join('_');

        try {
            const newSession = new Session({
                sessionId,
                user: {
                    id: userId,
                    name: user.name,
                    email: user.email
                },
                librarian: {
                    id: socket.id,
                    name: librarian.name,
                    email: librarian.email
                }
            });

            await newSession.save();
        } catch (err) {
            console.error('Error creating session:', err);
        }
    });

    socket.on('end chat', async ({ userId }) => {
        if (librarians[socket.id]) {
            activeChats.delete(userId);
            Object.values(librarians).forEach(lib => {
                lib.socket.emit('user status changed', {
                    userId: userId,
                    status: 'available'
                });
            });
        }

        const sessionId = [userId, socket.id].sort().join('_');

        try {
            await Session.updateOne(
                { sessionId, status: 'active' },
                {
                    endTime: new Date(),
                    status: 'ended'
                }
            );
        } catch (err) {
            console.error('Error updating session:', err);
        }
    });

    socket.on('disconnect', () => {
        const wasLibrarian = !!librarians[socket.id];
        const userInfo = users[socket.id] || librarians[socket.id];

        if (userInfo) {
            if (users[socket.id] && activeChats.has(socket.id)) {
                activeChats.delete(socket.id);
                io.to(Object.keys(librarians)).emit('user status changed', {
                    userId: socket.id,
                    status: 'offline'
                });
            }

            io.to(Object.keys(librarians)).emit('user disconnected', socket.id);
        }

        delete users[socket.id];
        delete librarians[socket.id];
    });

    socket.on('logout', () => {
        const userId = socket.id;

        // Remove from active chats if present
        if (activeChats.has(userId)) {
            activeChats.delete(userId);

            // Notify other users about status change
            if (users[userId]) {
                io.to(Object.keys(librarians)).emit('user status changed', {
                    userId: userId,
                    status: 'offline'
                });
            }
        }

        // Remove from users or librarians
        if (users[userId]) {
            delete users[userId];
            io.to(Object.keys(librarians)).emit('user disconnected', userId);
        } else if (librarians[userId]) {
            delete librarians[userId];
        }

        // Disconnect the socket
        socket.disconnect();
    });
});

const PORT = process.env.PORT || 3000;

app.get('/chat-history/:sessionId', async (req, res) => {
    try {
        const messages = await Message.find({
            sessionId: req.params.sessionId
        }).sort({ timestamp: 1 });

        res.json(messages);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch chat history' });
    }
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
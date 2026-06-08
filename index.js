const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, "index.html")));

const users = {};
const sessions = {};
const players = {};

function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function genToken() { return crypto.randomBytes(16).toString('hex'); }
function getUsername(token) { return sessions[token] || null; }

// seed admin
users['zlati'] = { password: hash('changeme'), color: '#4ade80', admin: true, banned: false, friends: [], friendRequests: [], shirt: false };

io.on('connection', (socket) => {
  socket.on('register', ({ username, password }) => {
    username = username.trim().toLowerCase();
    if (!username || !password) return socket.emit('auth_error', 'Fill all fields');
    if (username.length < 3) return socket.emit('auth_error', 'Username too short');
    if (users[username]) return socket.emit('auth_error', 'Username taken');
    const colors = ['#60a5fa','#34d399','#f472b6','#fb923c','#a78bfa','#facc15','#38bdf8'];
    users[username] = { password: hash(password), color: colors[Math.floor(Math.random()*colors.length)], admin: false, banned: false, friends: [], friendRequests: [], shirt: false };
    const token = genToken(); sessions[token] = username;
    socket.emit('auth_ok', { token, username, color: users[username].color, admin: false });
  });

  socket.on('login', ({ username, password }) => {
    username = username.trim().toLowerCase();
    const user = users[username];
    if (!user) return socket.emit('auth_error', 'User not found');
    if (user.password !== hash(password)) return socket.emit('auth_error', 'Wrong password');
    if (user.banned) return socket.emit('auth_error', 'You are banned');
    const token = genToken(); sessions[token] = username;
    socket.emit('auth_ok', { token, username, color: user.color, admin: user.admin });
  });

  socket.on('join_world', ({ token }) => {
    const username = getUsername(token);
    const user = users[username];
    if (!username || !user) return socket.emit('kick', 'Not authenticated');
    if (user.banned) return socket.emit('kick', 'You are banned');
    socket.data.username = username;
    players[socket.id] = { username, x: (Math.random()-0.5)*30, y: 0, z: (Math.random()-0.5)*30, rotY: 0, color: user.color, shirt: user.shirt||false };
    socket.emit('world_state', { players: Object.entries(players).filter(([id]) => id !== socket.id).map(([id, p]) => ({ id, ...p })) });
    socket.broadcast.emit('player_joined', { id: socket.id, ...players[socket.id] });
    socket.emit('friend_data', { friends: user.friends, requests: user.friendRequests });
    socket.emit('shirt_status', { hasShirt: user.shirt||false });
  });

  socket.on('move', ({ x, y, z, rotY, anim }) => {
    if (!players[socket.id]) return;
    Object.assign(players[socket.id], { x, y, z, rotY, anim });
    socket.broadcast.emit('player_moved', { id: socket.id, x, y, z, rotY, anim });
  });

  socket.on('chat', ({ token, message }) => {
    const username = getUsername(token);
    if (!username || !message || message.length > 200) return;
    const user = users[username];
    io.emit('chat_msg', { username, message, color: user.color, admin: user.admin, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
  });

  socket.on('friend_request', ({ token, toUsername }) => {
    const from = getUsername(token); toUsername = toUsername.trim().toLowerCase();
    if (!from || !users[toUsername]) return socket.emit('friend_error', 'User not found');
    if (toUsername === from) return socket.emit('friend_error', "Can't add yourself");
    if (users[toUsername].friends.includes(from)) return socket.emit('friend_error', 'Already friends');
    if (users[toUsername].friendRequests.includes(from)) return socket.emit('friend_error', 'Request already sent');
    users[toUsername].friendRequests.push(from);
    socket.emit('friend_sent', toUsername);
    for (const [sid, p] of Object.entries(players)) { if (p.username === toUsername) io.to(sid).emit('friend_request_received', { from }); }
  });

  socket.on('friend_accept', ({ token, fromUsername }) => {
    const username = getUsername(token); fromUsername = fromUsername.trim().toLowerCase();
    const user = users[username];
    if (!user || !user.friendRequests.includes(fromUsername)) return;
    user.friendRequests = user.friendRequests.filter(u => u !== fromUsername);
    if (!user.friends.includes(fromUsername)) user.friends.push(fromUsername);
    if (users[fromUsername] && !users[fromUsername].friends.includes(username)) users[fromUsername].friends.push(username);
    socket.emit('friend_data', { friends: user.friends, requests: user.friendRequests });
    for (const [sid, p] of Object.entries(players)) { if (p.username === fromUsername) io.to(sid).emit('friend_accepted', { by: username }); }
  });

  socket.on('friend_decline', ({ token, fromUsername }) => {
    const username = getUsername(token); const user = users[username];
    if (!user) return;
    user.friendRequests = user.friendRequests.filter(u => u !== fromUsername);
    socket.emit('friend_data', { friends: user.friends, requests: user.friendRequests });
  });

  socket.on('friend_remove', ({ token, friendUsername }) => {
    const username = getUsername(token); if (!username) return;
    users[username].friends = users[username].friends.filter(u => u !== friendUsername);
    if (users[friendUsername]) users[friendUsername].friends = users[friendUsername].friends.filter(u => u !== username);
    socket.emit('friend_data', { friends: users[username].friends, requests: users[username].friendRequests });
  });

  socket.on('admin_action', ({ token, action, targetUsername }) => {
    const username = getUsername(token);
    if (!username || !users[username]?.admin) return socket.emit('admin_error', 'Not admin');
    if (targetUsername === 'zlati') return socket.emit('admin_error', "Can't target owner");
    const target = users[targetUsername.trim().toLowerCase()];
    if (!target) return socket.emit('admin_error', 'User not found');
    if (action === 'ban') { target.banned = true; for (const [sid, p] of Object.entries(players)) if (p.username === targetUsername) io.to(sid).emit('kick', 'Banned by admin.'); }
    else if (action === 'unban') target.banned = false;
    else if (action === 'kick') { for (const [sid, p] of Object.entries(players)) if (p.username === targetUsername) io.to(sid).emit('kick', 'Kicked by admin.'); }
    else if (action === 'makeadmin') target.admin = true;
    else if (action === 'removeadmin') target.admin = false;
    else if (action === 'giveshirt') {
      target.shirt = true;
      for (const [sid, p] of Object.entries(players)) if (p.username === targetUsername) io.to(sid).emit('shirt_granted');
    }
    socket.emit('admin_success', `Done: ${action} on ${targetUsername}`);
  });

  socket.on('admin_list', ({ token }) => {
    const username = getUsername(token);
    if (!username || !users[username]?.admin) return;
    socket.emit('admin_list', Object.entries(users).map(([u, d]) => ({ username: u, admin: d.admin, banned: d.banned, online: Object.values(players).some(p => p.username === u), shirt: d.shirt||false })));
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) { socket.broadcast.emit('player_left', { id: socket.id }); delete players[socket.id]; }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`ZoneWood running on port ${PORT}`));

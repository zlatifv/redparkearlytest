const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(express.static(__dirname));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

const users = {};
const sessions = {};
const players = {};

function hash(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function genToken() { return crypto.randomBytes(16).toString('hex'); }
function getUsername(token) { return sessions[token] || null; }

// seed admin
users['zlati'] = { password: hash('changeme'), color: '#4ade80', admin: true, mod: true, banned: false, muted: false, warnings: [], friends: [], friendRequests: [] };

// ==================== TAG MINI-GAME ====================
const tagGame = {
  active: false,
  itSocketId: null,
  startedAt: 0,
  duration: 90000, // 90 seconds
  participants: new Set(),
  timer: null
};

function broadcastTagState() {
  io.emit('tag_state', {
    active: tagGame.active,
    itUsername: tagGame.itSocketId && players[tagGame.itSocketId] ? players[tagGame.itSocketId].username : null,
    participants: Array.from(tagGame.participants).map(sid => players[sid]?.username).filter(Boolean),
    msLeft: tagGame.active ? Math.max(0, tagGame.duration - (Date.now() - tagGame.startedAt)) : 0
  });
}

function endTagGame(reason) {
  tagGame.active = false;
  if (tagGame.timer) clearTimeout(tagGame.timer);
  tagGame.timer = null;
  const winnerUsername = tagGame.itSocketId && players[tagGame.itSocketId] ? players[tagGame.itSocketId].username : null;
  io.emit('tag_ended', { reason, lastIt: winnerUsername });
  tagGame.itSocketId = null;
  tagGame.participants.clear();
  broadcastTagState();
}

io.on('connection', (socket) => {
  socket.on('token_login', ({ token }) => {
    const username = getUsername(token);
    const user = users[username];
    if (!username || !user) return socket.emit('token_invalid');
    if (user.banned) return socket.emit('token_invalid');
    socket.emit('auth_ok', { token, username, color: user.color, admin: user.admin, mod: !!user.mod });
  });

  socket.on('register', ({ username, password }) => {
    username = username.trim().toLowerCase();
    if (!username || !password) return socket.emit('auth_error', 'Fill all fields');
    if (username.length < 3) return socket.emit('auth_error', 'Username too short');
    if (users[username]) return socket.emit('auth_error', 'Username taken');
    const colors = ['#60a5fa','#34d399','#f472b6','#fb923c','#a78bfa','#facc15','#38bdf8'];
    users[username] = { password: hash(password), color: colors[Math.floor(Math.random()*colors.length)], admin: false, mod: false, banned: false, muted: false, warnings: [], friends: [], friendRequests: [] };
    const token = genToken(); sessions[token] = username;
    socket.emit('auth_ok', { token, username, color: users[username].color, admin: false, mod: false });
  });

  socket.on('login', ({ username, password }) => {
    username = username.trim().toLowerCase();
    const user = users[username];
    if (!user) return socket.emit('auth_error', 'User not found');
    if (user.password !== hash(password)) return socket.emit('auth_error', 'Wrong password');
    if (user.banned) return socket.emit('auth_error', 'You are banned');
    const token = genToken(); sessions[token] = username;
    socket.emit('auth_ok', { token, username, color: user.color, admin: user.admin, mod: !!user.mod });
  });

  socket.on('join_world', ({ token }) => {
    const username = getUsername(token);
    const user = users[username];
    if (!username || !user) return socket.emit('kick', 'Not authenticated');
    if (user.banned) return socket.emit('kick', 'You are banned');
    socket.data.username = username;
    players[socket.id] = { username, x: (Math.random()-0.5)*30, y: 0, z: (Math.random()-0.5)*30, rotY: 0, color: user.color };
    socket.emit('world_state', { players: Object.entries(players).filter(([id]) => id !== socket.id).map(([id, p]) => ({ id, ...p })) });
    socket.broadcast.emit('player_joined', { id: socket.id, ...players[socket.id] });
    socket.emit('friend_data', { friends: user.friends, requests: user.friendRequests });
    socket.emit('account_status', { mod: !!user.mod, muted: !!user.muted, warnings: user.warnings || [] });
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
    if (user.banned) return;
    if (user.muted) return socket.emit('chat_blocked', 'You are muted and cannot chat.');
    io.emit('chat_msg', { username, message, color: user.color, admin: user.admin, mod: !!user.mod, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
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

  socket.on('admin_action', ({ token, action, targetUsername, reason }) => {
    const username = getUsername(token);
    const actor = users[username];
    if (!username || !actor || (!actor.admin && !actor.mod)) return socket.emit('admin_error', 'Not authorized');
    if (targetUsername === 'zlati') return socket.emit('admin_error', "Can't target owner");
    const targetKey = targetUsername.trim().toLowerCase();
    const target = users[targetKey];
    if (!target) return socket.emit('admin_error', 'User not found');

    // Moderators can only kick, mute/unmute, and warn. Admins can do everything.
    const modAllowed = ['kick', 'mute', 'unmute', 'warn'];
    if (!actor.admin && actor.mod && !modAllowed.includes(action)) {
      return socket.emit('admin_error', 'Moderators cannot do that — admin only');
    }
    if ((action === 'makeadmin' || action === 'removeadmin' || action === 'makemod' || action === 'removemod') && !actor.admin) {
      return socket.emit('admin_error', 'Admin only action');
    }

    if (action === 'ban') {
      target.banned = true;
      for (const [sid, p] of Object.entries(players)) if (p.username === targetKey) io.to(sid).emit('kick', 'Banned by admin.');
    } else if (action === 'unban') {
      target.banned = false;
    } else if (action === 'kick') {
      for (const [sid, p] of Object.entries(players)) if (p.username === targetKey) io.to(sid).emit('kick', 'Kicked by admin.');
    } else if (action === 'makeadmin') {
      target.admin = true;
    } else if (action === 'removeadmin') {
      target.admin = false;
    } else if (action === 'makemod') {
      target.mod = true;
    } else if (action === 'removemod') {
      target.mod = false;
    } else if (action === 'mute') {
      target.muted = true;
      for (const [sid, p] of Object.entries(players)) if (p.username === targetKey) io.to(sid).emit('you_muted', true);
    } else if (action === 'unmute') {
      target.muted = false;
      for (const [sid, p] of Object.entries(players)) if (p.username === targetKey) io.to(sid).emit('you_muted', false);
    } else if (action === 'warn') {
      target.warnings = target.warnings || [];
      target.warnings.push({ by: username, reason: reason || 'No reason given', time: Date.now() });
      for (const [sid, p] of Object.entries(players)) {
        if (p.username === targetKey) io.to(sid).emit('you_warned', { by: username, reason: reason || 'No reason given', count: target.warnings.length });
      }
    }
    socket.emit('admin_success', `Done: ${action} on ${targetKey}`);
  });

  socket.on('admin_list', ({ token }) => {
    const username = getUsername(token);
    const actor = users[username];
    if (!username || !actor || (!actor.admin && !actor.mod)) return;
    socket.emit('admin_list', Object.entries(users).map(([u, d]) => ({
      username: u,
      admin: d.admin,
      mod: !!d.mod,
      banned: d.banned,
      muted: !!d.muted,
      warnings: (d.warnings || []).length,
      online: Object.values(players).some(p => p.username === u)
    })));
  });

  socket.on('visit_request', ({ token, toUsername }) => {
    const from = getUsername(token);
    toUsername = (toUsername || '').trim().toLowerCase();
    if (!from || !users[toUsername]) return socket.emit('visit_error', 'User not found');
    if (toUsername === from) return socket.emit('visit_error', "Can't visit yourself");
    // Find the target socket and send them the request
    for (const [sid, p] of Object.entries(players)) {
      if (p.username === toUsername) {
        io.to(sid).emit('visit_request_received', { from, fromColor: users[from]?.color || '#fff' });
        return;
      }
    }
    socket.emit('visit_error', `${toUsername} is not online`);
  });

  socket.on('visit_accept', ({ token, fromUsername }) => {
    const username = getUsername(token);
    fromUsername = (fromUsername || '').trim().toLowerCase();
    if (!username) return;
    // Teleport the requester to the accepter's position
    const accepterPlayer = Object.values(players).find(p => p.username === username);
    for (const [sid, p] of Object.entries(players)) {
      if (p.username === fromUsername) {
        io.to(sid).emit('visit_teleport', {
          x: accepterPlayer ? accepterPlayer.x : 0,
          y: accepterPlayer ? accepterPlayer.y : 0,
          z: accepterPlayer ? accepterPlayer.z : 0,
          toUsername: username
        });
        socket.emit('visit_guest_arriving', { fromUsername });
        return;
      }
    }
  });

  socket.on('visit_decline', ({ token, fromUsername }) => {
    const username = getUsername(token);
    fromUsername = (fromUsername || '').trim().toLowerCase();
    if (!username) return;
    for (const [sid, p] of Object.entries(players)) {
      if (p.username === fromUsername) {
        io.to(sid).emit('visit_declined', { by: username });
        return;
      }
    }
  });

  socket.on('tag_join', ({ token }) => {
    const username = getUsername(token);
    if (!username) return;
    if (!tagGame.active) return socket.emit('tag_error', 'No game in progress. Start one!');
    tagGame.participants.add(socket.id);
    broadcastTagState();
  });

  socket.on('tag_start', ({ token }) => {
    const username = getUsername(token);
    if (!username || !players[socket.id]) return socket.emit('tag_error', 'You must be in the world to start a game');
    if (tagGame.active) return socket.emit('tag_error', 'A game is already in progress');
    tagGame.active = true;
    tagGame.itSocketId = socket.id;
    tagGame.startedAt = Date.now();
    tagGame.participants = new Set([socket.id]);
    io.emit('tag_announce', `🎯 Tag started! ${username} is IT — run!`);
    broadcastTagState();
    tagGame.timer = setTimeout(() => endTagGame('Time ran out!'), tagGame.duration);
  });

  socket.on('tag_tag', ({ token, targetUsername }) => {
    const username = getUsername(token);
    if (!username || !tagGame.active) return;
    if (tagGame.itSocketId !== socket.id) return socket.emit('tag_error', "You're not IT");
    const targetSid = Object.entries(players).find(([sid, p]) => p.username === targetUsername.trim().toLowerCase())?.[0];
    if (!targetSid) return socket.emit('tag_error', 'Player not found');
    if (!tagGame.participants.has(targetSid)) return socket.emit('tag_error', 'That player is not in the game');
    tagGame.itSocketId = targetSid;
    tagGame.participants.add(targetSid);
    io.emit('tag_announce', `🎯 ${players[targetSid].username} is now IT!`);
    broadcastTagState();
  });

  socket.on('tag_stop', ({ token }) => {
    const username = getUsername(token);
    if (!username) return;
    if (tagGame.itSocketId === socket.id || users[username]?.admin || users[username]?.mod) {
      endTagGame('Game stopped.');
    }
  });

  socket.on('disconnect', () => {
    if (players[socket.id]) { socket.broadcast.emit('player_left', { id: socket.id }); delete players[socket.id]; }
    if (tagGame.active && tagGame.itSocketId === socket.id) endTagGame('The tagger left the game.');
    tagGame.participants.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Red Park running on port ${PORT}`));

// ==================== CURRENCY SYSTEM ====================
class CurrencySystem {
  constructor() {
    this.currencyName = 'Coins';
    this.currencySymbol = '🪙';
    this.players = this.loadAllPlayers();
    this.currentPlayerId = 'player_' + Math.random().toString(36).substr(2, 9);
    this.initializePlayer(this.currentPlayerId);
  }

  initializePlayer(playerId) {
    if (!this.players[playerId]) {
      this.players[playerId] = {
        id: playerId,
        balance: 500,
        totalEarned: 0,
        totalSpent: 0,
        transactions: [],
        createdAt: new Date().toISOString()
      };
      this.saveAllPlayers();
    }
    return this.players[playerId];
  }

  addCurrency(playerId, amount, reason = 'activity') {
    const player = this.initializePlayer(playerId);
    player.balance += amount;
    player.totalEarned += amount;

    player.transactions.push({
      type: 'earn',
      amount: amount,
      reason: reason,
      timestamp: new Date().toISOString()
    });

    this.saveAllPlayers();
    this.displayNotification(`+${amount} ${this.currencySymbol}`, 'success');
    this.updateBalanceDisplay(playerId);
    return player;
  }

  deductCurrency(playerId, amount, reason = 'purchase') {
    const player = this.initializePlayer(playerId);

    if (player.balance < amount) {
      this.displayNotification('❌ Insufficient currency!', 'error');
      return false;
    }

    player.balance -= amount;
    player.totalSpent += amount;

    player.transactions.push({
      type: 'spend',
      amount: amount,
      reason: reason,
      timestamp: new Date().toISOString()
    });

    this.saveAllPlayers();
    this.displayNotification(`-${amount} ${this.currencySymbol}`, 'warning');
    this.updateBalanceDisplay(playerId);
    return true;
  }

  getBalance(playerId) {
    const player = this.initializePlayer(playerId);
    return player.balance;
  }

  getPlayerStats(playerId) {
    return this.initializePlayer(playerId);
  }

  saveAllPlayers() {
    localStorage.setItem('redpark_players', JSON.stringify(this.players));
  }

  loadAllPlayers() {
    const data = localStorage.getItem('redpark_players');
    return data ? JSON.parse(data) : {};
  }

  displayNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => notification.remove(), 3000);
  }

  updateBalanceDisplay(playerId) {
    const balance = this.getBalance(playerId);
    const displayElements = document.querySelectorAll('[data-balance-display]');
    displayElements.forEach(el => {
      el.textContent = `${this.currencySymbol} ${balance}`;
    });
  }
}

// ==================== MINI GAMES ====================
class MiniGames {
  constructor(currencySystem) {
    this.currency = currencySystem;
  }

  // Game 1: Coin Flip
  playCoinFlip(playerId) {
    const bet = 10;
    if (this.currency.getBalance(playerId) < bet) {
      this.currency.displayNotification('Not enough currency to play!', 'error');
      return;
    }

    this.currency.deductCurrency(playerId, bet, 'coin-flip-bet');

    const modal = this.createGameModal('🪙 Coin Flip', `
      <div style="text-align: center; padding: 20px;">
        <p style="font-size: 16px; margin-bottom: 20px;">Choose: Heads or Tails?</p>
        <div class="flip-container">
          <button class="flip-btn" onclick="window.miniGames.resolveCoinFlip('${playerId}', 'heads', ${bet})">
            👤 Heads
          </button>
          <button class="flip-btn" onclick="window.miniGames.resolveCoinFlip('${playerId}', 'tails', ${bet})">
            🪙 Tails
          </button>
        </div>
        <div id="result" class="result-display" style="display: none;"></div>
      </div>
    `);
  }

  resolveCoinFlip(playerId, choice, bet) {
    const result = Math.random() > 0.5 ? 'heads' : 'tails';
    const resultDiv = document.querySelector('#result');
    resultDiv.style.display = 'block';

    if (choice === result) {
      const reward = bet * 2;
      this.currency.addCurrency(playerId, reward, 'coin-flip-win');
      resultDiv.innerHTML = `✅ You Won!<br>${result.toUpperCase()}<br>+${reward} ${this.currency.currencySymbol}`;
      resultDiv.style.color = '#4CAF50';
    } else {
      resultDiv.innerHTML = `❌ You Lost!<br>It was ${result.toUpperCase()}`;
      resultDiv.style.color = '#f44336';
    }

    setTimeout(() => {
      const modal = resultDiv.closest('.modal');
      if (modal && modal.parentElement) {
        modal.parentElement.remove();
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) overlay.remove();
      }
    }, 2500);
  }

  // Game 2: Number Guessing
  playNumberGuessing(playerId) {
    const bet = 15;
    if (this.currency.getBalance(playerId) < bet) {
      this.currency.displayNotification('Not enough currency to play!', 'error');
      return;
    }

    this.currency.deductCurrency(playerId, bet, 'number-guess-bet');
    const secretNumber = Math.floor(Math.random() * 10) + 1;

    const modal = this.createGameModal('🎲 Number Guessing', `
      <div style="text-align: center; padding: 20px;">
        <p style="margin-bottom: 20px;">Guess a number between 1 and 10</p>
        <div class="number-input-container">
          <input type="number" id="guess-input" min="1" max="10" placeholder="Enter number">
          <button onclick="window.miniGames.checkGuess('${playerId}', ${secretNumber}, ${bet})">
            Guess
          </button>
        </div>
        <div id="guess-result" class="result-display"></div>
      </div>
    `);

    document.getElementById('guess-input').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        window.miniGames.checkGuess(playerId, secretNumber, bet);
      }
    });

    window.miniGames.attempts = 0;
  }

  checkGuess(playerId, secretNumber, bet) {
    const guessInput = document.getElementById('guess-input');
    const guess = parseInt(guessInput.value);
    const resultDiv = document.getElementById('guess-result');
    this.attempts = (this.attempts || 0) + 1;

    if (isNaN(guess)) {
      resultDiv.textContent = 'Please enter a valid number';
      resultDiv.style.color = '#FF9800';
      return;
    }

    if (guess === secretNumber) {
      const reward = bet * 3;
      this.currency.addCurrency(playerId, reward, 'number-guess-win');
      resultDiv.innerHTML = `✅ Correct!<br>The number was ${secretNumber}<br>+${reward} ${this.currency.currencySymbol}`;
      resultDiv.style.color = '#4CAF50';
      guessInput.disabled = true;
      document.querySelector('button[onclick*="checkGuess"]').disabled = true;
      setTimeout(() => {
        const overlay = document.querySelector('.modal-overlay');
        if (overlay) overlay.click();
      }, 2500);
    } else {
      const hint = guess < secretNumber ? '📈 Too Low' : '📉 Too High';
      resultDiv.innerHTML = `${hint}<br>Attempt ${this.attempts} - Try again!`;
      resultDiv.style.color = '#FF9800';
      guessInput.value = '';
      guessInput.focus();
    }
  }

  // Game 3: Memory Match
  playMemoryMatch(playerId) {
    const bet = 20;
    if (this.currency.getBalance(playerId) < bet) {
      this.currency.displayNotification('Not enough currency to play!', 'error');
      return;
    }

    this.currency.deductCurrency(playerId, bet, 'memory-match-bet');

    const emojis = ['🍎', '🍌', '🍒', '🍇', '🍎', '🍌', '🍒', '🍇'];
    const shuffled = emojis.sort(() => Math.random() - 0.5);

    const modal = this.createGameModal('🧠 Memory Match', `
      <div style="padding: 20px;">
        <p style="text-align: center; margin-bottom: 20px;">Find matching pairs!</p>
        <div class="memory-grid" id="memory-grid">
          ${shuffled.map((_, i) => `
            <button class="memory-card" data-index="${i}" data-emoji="${shuffled[i]}">?</button>
          `).join('')}
        </div>
        <div id="memory-result" class="result-display"></div>
      </div>
    `);

    window.miniGames.memoryState = {
      flipped: [],
      matched: 0,
      shuffled: shuffled,
      bet: bet,
      playerId: playerId,
      disabled: false
    };

    const cards = modal.querySelectorAll('.memory-card');
    cards.forEach(card => {
      card.addEventListener('click', () => window.miniGames.handleMemoryClick(card));
    });
  }

  handleMemoryClick(card) {
    const state = this.memoryState;

    if (state.disabled || state.flipped.includes(card) || card.classList.contains('matched')) {
      return;
    }

    card.textContent = card.dataset.emoji;
    card.style.background = '#4CAF50';
    state.flipped.push(card);

    if (state.flipped.length === 2) {
      state.disabled = true;

      setTimeout(() => {
        const [card1, card2] = state.flipped;

        if (card1.dataset.emoji === card2.dataset.emoji) {
          card1.classList.add('matched');
          card2.classList.add('matched');
          state.matched++;

          if (state.matched === 4) {
            const reward = state.bet * 2.5;
            this.currency.addCurrency(state.playerId, reward, 'memory-match-win');
            const resultDiv = document.getElementById('memory-result');
            resultDiv.innerHTML = `✅ You matched all pairs!<br>+${Math.floor(reward)} ${this.currency.currencySymbol}`;
            resultDiv.style.color = '#4CAF50';

            setTimeout(() => {
              const overlay = document.querySelector('.modal-overlay');
              if (overlay) overlay.click();
            }, 2000);
          }
        } else {
          card1.textContent = '?';
          card2.textContent = '?';
          card1.style.background = '#667eea';
          card2.style.background = '#667eea';
        }

        state.flipped = [];
        state.disabled = false;
      }, 600);
    }
  }

  // Game 4: Tap Speed
  playTapSpeed(playerId) {
    const bet = 10;
    if (this.currency.getBalance(playerId) < bet) {
      this.currency.displayNotification('Not enough currency to play!', 'error');
      return;
    }

    this.currency.deductCurrency(playerId, bet, 'tap-speed-bet');

    const modal = this.createGameModal('⚡ Tap Speed', `
      <div style="text-align: center; padding: 20px;">
        <p style="margin-bottom: 20px;">Click as fast as you can for 5 seconds!</p>
        <button class="tap-button" id="tap-button" onclick="window.miniGames.handleTapClick()">
          🎯 TAP ME!
        </button>
        <div id="tap-counter" style="font-size: 24px; font-weight: bold; margin: 20px 0;">Taps: 0</div>
        <div id="tap-result" class="result-display"></div>
      </div>
    `);

    window.miniGames.tapState = {
      taps: 0,
      active: true,
      bet: bet,
      playerId: playerId
    };

    setTimeout(() => {
      window.miniGames.endTapGame();
    }, 5000);
  }

  handleTapClick() {
    if (this.tapState && this.tapState.active) {
      this.tapState.taps++;
      document.getElementById('tap-counter').textContent = `Taps: ${this.tapState.taps}`;
    }
  }

  endTapGame() {
    if (!this.tapState) return;

    this.tapState.active = false;
    const tapButton = document.getElementById('tap-button');
    if (tapButton) {
      tapButton.disabled = true;
    }

    const reward = Math.floor(this.tapState.bet * (1 + this.tapState.taps / 50));
    this.currency.addCurrency(this.tapState.playerId, reward, 'tap-speed-win');

    const resultDiv = document.getElementById('tap-result');
    resultDiv.innerHTML = `✅ Final Score: ${this.tapState.taps} taps!<br>+${reward} ${this.currency.currencySymbol}`;
    resultDiv.style.color = '#4CAF50';

    setTimeout(() => {
      const overlay = document.querySelector('.modal-overlay');
      if (overlay) overlay.click();
    }, 2500);
  }

  // Game 5: Color Match
  playColorMatch(playerId) {
    const bet = 12;
    if (this.currency.getBalance(playerId) < bet) {
      this.currency.displayNotification('Not enough currency to play!', 'error');
      return;
    }

    this.currency.deductCurrency(playerId, bet, 'color-match-bet');

    const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];
    const colorCodes = {
      red: '#f44336',
      blue: '#2196F3',
      green: '#4CAF50',
      yellow: '#FFC107',
      purple: '#9C27B0',
      orange: '#FF9800'
    };

    const colorNames = colors.sort(() => Math.random() - 0.5);
    const targetColor = colorNames[0];

    const modal = this.createGameModal('🎨 Color Match', `
      <div style="padding: 20px; text-align: center;">
        <p style="margin-bottom: 20px; font-size: 16px;">Click the button that matches this color:</p>
        <div style="width: 100px; height: 100px; background: ${colorCodes[targetColor]}; margin: 20px auto; border-radius: 8px;"></div>
        <div id="color-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 20px 0; max-width: 300px; margin-left: auto; margin-right: auto;">
          ${colorNames.map((color, idx) => `
            <button style="padding: 20px; background: ${colorCodes[color]}; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; color: white;" 
              onclick="window.miniGames.checkColorMatch('${playerId}', '${color}', '${targetColor}', ${bet})">
              ${color}
            </button>
          `).join('')}
        </div>
        <div id="color-result" class="result-display"></div>
      </div>
    `);

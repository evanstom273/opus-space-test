import { Game } from './game/Game.js';

const game = new Game(document.getElementById('app'), document.getElementById('hud'));
window.__game = game;
game.start();

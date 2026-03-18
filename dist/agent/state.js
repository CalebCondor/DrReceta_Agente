"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sessions = exports.conversations = exports.client = exports.ANTHROPIC_MODEL = void 0;
const sdk_1 = __importDefault(require("@anthropic-ai/sdk"));
if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('Missing ANTHROPIC_API_KEY');
exports.ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
exports.client = new sdk_1.default({ apiKey: process.env.ANTHROPIC_API_KEY });
exports.conversations = new Map();
exports.sessions = new Map();
//# sourceMappingURL=state.js.map
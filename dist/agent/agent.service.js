"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var AgentService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentService = void 0;
const common_1 = require("@nestjs/common");
const state_1 = require("./state");
const tools_1 = require("./tools");
const executor_1 = require("./executor");
const system_1 = require("./system");
const db_service_1 = require("./db.service");
let AgentService = AgentService_1 = class AgentService {
    db;
    logger = new common_1.Logger(AgentService_1.name);
    constructor(db) {
        this.db = db;
    }
    async loadHistoryIfEmpty(chatId) {
        if (!state_1.conversations.has(chatId)) {
            try {
                const { rows } = await this.db.query('SELECT role, content FROM historial_mensajes WHERE chat_id = $1 ORDER BY created_at ASC LIMIT 50', [chatId]);
                const history = rows.map((r) => {
                    let content = r.content;
                    if (typeof content === 'string') {
                        try {
                            content = JSON.parse(content);
                        }
                        catch {
                        }
                    }
                    return { role: r.role, content };
                });
                state_1.conversations.set(chatId, history);
            }
            catch (e) {
                this.logger.error(`Error loading history for ${chatId}: ${e}`);
                state_1.conversations.set(chatId, []);
            }
        }
        return state_1.conversations.get(chatId);
    }
    normalizeMessages(msgs) {
        const fixed = msgs.map((m) => {
            let content = m.content;
            if (content === null || content === undefined) {
                content = m.role === 'assistant' ? [] : '';
            }
            if (!Array.isArray(content) && typeof content === 'object') {
                content = [
                    content,
                ];
            }
            if (m.role === 'assistant' && typeof content === 'string') {
                content = [{ type: 'text', text: content }];
            }
            return { role: m.role, content };
        });
        const result = [];
        for (let i = 0; i < fixed.length; i++) {
            const m = fixed[i];
            if (m.role === 'assistant' && Array.isArray(m.content)) {
                const hasToolUse = m.content.some((b) => typeof b === 'object' &&
                    b !== null &&
                    'type' in b &&
                    b.type === 'tool_use');
                if (hasToolUse) {
                    const next = fixed[i + 1];
                    const nextHasResult = next?.role === 'user' &&
                        Array.isArray(next.content) &&
                        next.content.some((b) => typeof b === 'object' &&
                            b !== null &&
                            'type' in b &&
                            b.type === 'tool_result');
                    if (!nextHasResult) {
                        this.logger.warn('Dropped orphaned tool_use assistant message');
                        continue;
                    }
                }
            }
            if (m.role === 'user' && Array.isArray(m.content)) {
                const hasToolResult = m.content.some((b) => typeof b === 'object' &&
                    b !== null &&
                    'type' in b &&
                    b.type === 'tool_result');
                if (hasToolResult) {
                    const prev = result[result.length - 1];
                    const prevHasToolUse = prev?.role === 'assistant' &&
                        Array.isArray(prev.content) &&
                        prev.content.some((b) => typeof b === 'object' &&
                            b !== null &&
                            'type' in b &&
                            b.type === 'tool_use');
                    if (!prevHasToolUse) {
                        this.logger.warn('Dropped orphaned tool_result user message');
                        continue;
                    }
                }
            }
            result.push(m);
        }
        return result;
    }
    async persistMessage(chatId, role, content) {
        try {
            await this.db.query('INSERT INTO historial_mensajes (chat_id, role, content) VALUES ($1, $2, $3)', [chatId, role, JSON.stringify(content)]);
        }
        catch (e) {
            this.logger.error(`Error persisting message: ${e}`);
        }
    }
    async runAgentCore(chatId, userText) {
        const history = await this.loadHistoryIfEmpty(chatId);
        history.push({ role: 'user', content: userText });
        await this.persistMessage(chatId, 'user', userText);
        if (history.length > 50)
            history.splice(0, history.length - 50);
        const messages = this.normalizeMessages([
            ...history,
        ]);
        const collected = [];
        for (let round = 0; round < 10; round++) {
            const systemPrompt = await (0, system_1.buildSystem)(chatId, this.db);
            const response = await state_1.client.messages.create({
                model: state_1.ANTHROPIC_MODEL,
                max_tokens: 4096,
                system: systemPrompt,
                tools: tools_1.TOOLS,
                messages,
            });
            const textBlocks = response.content
                .filter((b) => b.type === 'text')
                .map((b) => b.text);
            const toolUses = response.content.filter((b) => b.type === 'tool_use');
            if (toolUses.length === 0) {
                const finalText = textBlocks.join('\n').trim();
                if (finalText) {
                    const finalContent = [
                        { type: 'text', text: finalText },
                    ];
                    history.push({ role: 'assistant', content: finalContent });
                    await this.persistMessage(chatId, 'assistant', finalContent);
                    collected.push(finalText);
                }
                return collected.join('\n');
            }
            messages.push({ role: 'assistant', content: response.content });
            history.push({ role: 'assistant', content: response.content });
            await this.persistMessage(chatId, 'assistant', response.content);
            const toolResults = [];
            for (const tu of toolUses) {
                this.logger.log(`tool=${tu.name} input=${JSON.stringify(tu.input)}`);
                const resultStr = await (0, executor_1.executeTool)(tu.name, tu.input, chatId, this.db);
                this.logger.log(`result=${resultStr.slice(0, 200)}`);
                try {
                    const parsed = JSON.parse(resultStr);
                    if (parsed.success && parsed.formatted_html) {
                        collected.push(parsed.formatted_html);
                    }
                }
                catch {
                }
                let resultForClaude = resultStr;
                try {
                    const parsed = JSON.parse(resultStr);
                    if (parsed.formatted_html) {
                        delete parsed.formatted_html;
                        resultForClaude = JSON.stringify(parsed);
                    }
                }
                catch {
                }
                toolResults.push({
                    type: 'tool_result',
                    tool_use_id: tu.id,
                    content: resultForClaude,
                });
            }
            messages.push({ role: 'user', content: toolResults });
            history.push({ role: 'user', content: toolResults });
            await this.persistMessage(chatId, 'user', toolResults);
        }
        return collected.join('\n');
    }
    async retryWithFreshHistory(chatId, userText) {
        this.logger.warn(`Historial corrupto para chat ${chatId}. Limpiando y reintentando...`);
        state_1.conversations.delete(chatId);
        try {
            await this.db.query('DELETE FROM historial_mensajes WHERE chat_id = $1', [
                chatId,
            ]);
        }
        catch (e) {
            this.logger.error(`Error cleaning history: ${e}`);
        }
        const freshMessages = [
            { role: 'user', content: userText },
        ];
        const systemPrompt = await (0, system_1.buildSystem)(chatId, this.db);
        const response = await state_1.client.messages.create({
            model: state_1.ANTHROPIC_MODEL,
            max_tokens: 2048,
            system: systemPrompt,
            tools: tools_1.TOOLS,
            messages: freshMessages,
        });
        const finalText = response.content
            .filter((b) => b.type === 'text')
            .map((b) => b.text)
            .join('\n')
            .trim();
        if (finalText) {
            state_1.conversations.set(chatId, [
                { role: 'user', content: userText },
                { role: 'assistant', content: [{ type: 'text', text: finalText }] },
            ]);
            await this.persistMessage(chatId, 'user', userText);
            await this.persistMessage(chatId, 'assistant', [
                { type: 'text', text: finalText },
            ]);
        }
        return finalText;
    }
    async chat(chatId, userText) {
        try {
            return await this.runAgentCore(chatId, userText);
        }
        catch (e) {
            const errStr = String(e);
            if (errStr.includes('valid list') || errStr.includes('400')) {
                try {
                    return await this.retryWithFreshHistory(chatId, userText);
                }
                catch (retryErr) {
                    this.logger.error(`Retry failed: ${retryErr}`);
                    throw new Error('Ocurrió un error procesando tu mensaje. Por favor intenta de nuevo.');
                }
            }
            this.logger.error(`Agent error: ${e}`);
            throw e;
        }
    }
};
exports.AgentService = AgentService;
exports.AgentService = AgentService = AgentService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [db_service_1.DbService])
], AgentService);
//# sourceMappingURL=agent.service.js.map
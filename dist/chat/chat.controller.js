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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ChatController = void 0;
const common_1 = require("@nestjs/common");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const agent_service_1 = require("../agent/agent.service");
const chat_service_1 = require("./chat.service");
class ChatDto {
    chat_id;
    message;
}
__decorate([
    (0, class_validator_1.IsNumber)(),
    (0, class_transformer_1.Type)(() => Number),
    __metadata("design:type", Number)
], ChatDto.prototype, "chat_id", void 0);
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    __metadata("design:type", String)
], ChatDto.prototype, "message", void 0);
let ChatController = class ChatController {
    agentService;
    chatService;
    constructor(agentService, chatService) {
        this.agentService = agentService;
        this.chatService = chatService;
    }
    async chat(body) {
        try {
            const response = await this.agentService.chat(body.chat_id, body.message);
            return { success: true, response };
        }
        catch (e) {
            const message = e instanceof Error ? e.message : 'Internal server error';
            throw new common_1.HttpException({ success: false, error: message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getChatsByUser(usId) {
        try {
            const messages = await this.chatService.getChatsByUserId(usId);
            return { success: true, chat_id: usId, total: messages.length, messages };
        }
        catch (e) {
            const message = e instanceof Error ? e.message : 'Internal server error';
            throw new common_1.HttpException({ success: false, error: message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
    async getAllUserIds() {
        try {
            const user_ids = await this.chatService.getAllUserIds();
            return { success: true, total: user_ids.length, user_ids };
        }
        catch (e) {
            const message = e instanceof Error ? e.message : 'Internal server error';
            throw new common_1.HttpException({ success: false, error: message }, common_1.HttpStatus.INTERNAL_SERVER_ERROR);
        }
    }
};
exports.ChatController = ChatController;
__decorate([
    (0, common_1.Post)('chat'),
    (0, common_1.HttpCode)(200),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ChatDto]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "chat", null);
__decorate([
    (0, common_1.Get)('chats/user/:us_id'),
    __param(0, (0, common_1.Param)('us_id', common_1.ParseIntPipe)),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Number]),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getChatsByUser", null);
__decorate([
    (0, common_1.Get)('chats/users'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ChatController.prototype, "getAllUserIds", null);
exports.ChatController = ChatController = __decorate([
    (0, common_1.Controller)('api'),
    __metadata("design:paramtypes", [agent_service_1.AgentService,
        chat_service_1.ChatService])
], ChatController);
//# sourceMappingURL=chat.controller.js.map
"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var DbService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.DbService = void 0;
const common_1 = require("@nestjs/common");
const pg_1 = require("pg");
let DbService = DbService_1 = class DbService {
    logger = new common_1.Logger(DbService_1.name);
    pool;
    onModuleInit() {
        this.pool = new pg_1.Pool({
            host: process.env.DB_HOST || '187.77.15.77',
            port: parseInt(process.env.DB_PORT || '5432'),
            database: process.env.DB_NAME || 'AGENTEIA',
            user: process.env.DB_USER || 'agente',
            password: process.env.DB_PASSWORD,
        });
        this.initTables().catch((e) => this.logger.error('DB init failed', e));
    }
    query(text, params) {
        return this.pool.query(text, params);
    }
    async initTables() {
        await this.pool.query(`
      CREATE TABLE IF NOT EXISTS conocimiento_especifico (
        id SERIAL PRIMARY KEY, pregunta TEXT NOT NULL, respuesta TEXT NOT NULL,
        fuente TEXT DEFAULT 'aprendizaje_ia', created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS memoria_largo_plazo (
        id SERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, clave TEXT NOT NULL,
        valor TEXT NOT NULL, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_memoria_usuario ON memoria_largo_plazo (chat_id, clave);
      CREATE TABLE IF NOT EXISTS historial_mensajes (
        id SERIAL PRIMARY KEY, chat_id BIGINT NOT NULL, role TEXT NOT NULL,
        content JSONB NOT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_historial_chat ON historial_mensajes (chat_id, created_at);
    `);
        this.logger.log('Database initialized successfully.');
    }
};
exports.DbService = DbService;
exports.DbService = DbService = DbService_1 = __decorate([
    (0, common_1.Injectable)()
], DbService);
//# sourceMappingURL=db.service.js.map
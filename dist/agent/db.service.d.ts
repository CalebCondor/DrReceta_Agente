import { OnModuleInit } from '@nestjs/common';
export declare class DbService implements OnModuleInit {
    private readonly logger;
    private pool;
    onModuleInit(): void;
    query(text: string, params?: any[]): Promise<import("pg").QueryResult<any>>;
    private initTables;
}

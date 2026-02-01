import { Context, Next } from 'hono';
export interface AgentContext {
    agentId: string;
    publicKey: string;
}
/**
 * Verify agent signature for authenticated requests
 */
export declare function verifyAgent(c: Context, next: Next): Promise<(Response & import("hono").TypedResponse<{
    error: string;
}, 401, "json">) | undefined>;
/**
 * Optional auth - populates agent context if headers present
 */
export declare function optionalAgent(c: Context, next: Next): Promise<void>;

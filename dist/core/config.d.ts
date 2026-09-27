/**
 * src/core/config.ts
 *
 * Configuration type and loader for Bobtention.
 *
 * Resolution order (last wins):
 *   1. Built-in defaults
 *   2. Global config:    ~/.bobtention/config.json
 *   3. Workspace config: ./bobtention.config.json
 *
 * Config loader returns a complete, typed config even when files are missing or partial.
 */
export interface BobtentionConfig {
    enabled: boolean;
    decisionEngine: {
        provider: 'laya' | 'local';
        /** Required when provider is 'laya'. Default: http://localhost:8000/v1/systemone */
        endpoint?: string;
        /** Request timeout in ms. Default: 3000 */
        timeout: number;
    };
    autonomy: {
        default: 'autonomous';
        /** Confidence threshold above which WATCH is triggered. Default: 0.55 */
        watchThreshold: number;
        /** Confidence threshold above which BLOCK is triggered. Default: 0.85 */
        blockThreshold: number;
    };
    signals: {
        taskDrift: boolean;
        repeatedFailure: boolean;
        scopeExpansion: boolean;
        highImpactAction: boolean;
        uncertainty: boolean;
    };
    highImpactPatterns: Array<{
        pattern: string;
        category: string;
    }>;
    humanOverride: {
        enabled: boolean;
    };
    session: {
        /** Bounded action history window. Default: 50 */
        maxActions: number;
        /** Default: .bobtention/sessions (workspace-local; override via bobtention.config.json) */
        storagePath: string;
    };
}
/**
 * Load and cache the merged Bobtention config.
 * Call with `force = true` in tests to reload from disk.
 */
export declare function loadConfig(force?: boolean): BobtentionConfig;
/** Reset cached config (for testing only) */
export declare function resetConfigCache(): void;
//# sourceMappingURL=config.d.ts.map
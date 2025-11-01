import type { ChatRequest, ModelInfo } from './types';

const BEDROCK_BASE_URL = '/api/bedrock';

export class BedrockService {
    async getModels(): Promise<ModelInfo[]> {
        try {
            const response = await fetch(`${BEDROCK_BASE_URL}/models`);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log(`Bedrock: Received ${data.models?.length || 0} models`);

            return data.models || [];
        } catch (error) {
            const err = error as Error;
            console.error('Bedrock: Failed to fetch models:', error);

            // Pass through the error message from the server
            if (err.message?.includes('credentials') || err.message?.includes('AWS')) {
                throw err;
            }

            throw new Error('Cannot connect to Amazon Bedrock. Please check your AWS credentials.');
        }
    }

    async *chat(request: ChatRequest): AsyncGenerator<string, void, unknown> {
        try {
            // Transform messages to support both string and ContentBlock[] content
            const transformedMessages = request.messages.map(msg => {
                // If content is already an array or has files, keep as is
                if (typeof msg.content !== 'string' || (msg as any).files) {
                    return msg;
                }
                // Otherwise, keep string content
                return msg;
            });

            const response = await fetch(`${BEDROCK_BASE_URL}/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: request.model,
                    messages: transformedMessages,
                    temperature: request.temperature ?? 0.7,
                    max_tokens: request.max_tokens ?? 2048,
                    top_p: request.top_p ?? 0.9,
                }),
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Response body is not readable');
            }

            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const data = line.slice(6);
                        if (data === '[DONE]') continue;

                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.content) {
                                yield parsed.content;
                            } else if (parsed.metadata) {
                                // Yield metadata as a special marker
                                yield `__BEDROCK_METADATA__${JSON.stringify(parsed.metadata)}`;
                            }
                        } catch (e) {
                            console.error('Failed to parse SSE data:', e);
                        }
                    }
                }
            }
        } catch (error) {
            const err = error as Error;
            console.error('Bedrock: Chat error:', error);
            throw err;
        }
    }

    async checkConnection(): Promise<boolean> {
        try {
            const response = await fetch(`${BEDROCK_BASE_URL}/models`);
            return response.ok;
        } catch {
            return false;
        }
    }
}

export const bedrockService = new BedrockService();

import { createSchema, createYoga } from 'graphql-yoga';

// 定义环境变量接口
interface Env {
	DEEPSEEK_API_KEY: string;
	// 如果有其他环境变量，也可以在这里添加
	ENVIRONMENT?: string;
	DOAMIN: string;
}

// DeepSeek API 响应数据的接口定义
interface DeepSeekMessage {
	role: string;
	content: string;
}

interface DeepSeekChoice {
	index: number;
	message: DeepSeekMessage;
	finish_reason: string;
}

interface DeepSeekUsage {
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
}

interface DeepSeekResponse {
	id: string;
	object: string;
	created: number;
	model: string;
	choices: DeepSeekChoice[];
	usage: DeepSeekUsage;
}
function getCORSHeaders(request: Request, env: Env): Record<string, string> {
	const origin = request.headers.get('Origin') || '';
	let allowedOrigin = '';
	if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
		allowedOrigin = origin;
	} else if (origin.endsWith(env.DOAMIN)) {
		allowedOrigin = origin;
	}

	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	};
}
export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// 添加请求URL和方法的日志
		console.log(`收到请求: ${request.method} ${request.url}`);

		// 检查是否是 /graphql 路径
		const url = new URL(request.url);
		// 如果路径不是 /graphql，返回404
		if (url.pathname !== '/graphql') {
			console.log(`路径不匹配: ${url.pathname}, 期望: /graphql`);
			return new Response('Not Found', { status: 404 });
		}

		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: getCORSHeaders(request, env)
			});
		}

		const isProduction = env.ENVIRONMENT === 'production';
		const yoga = createYoga({
			schema: createSchema({
				typeDefs: /* GraphQL */ `
					type Query {
						ask(prompt: String!): String!
					}
				`,
				resolvers: {
					Query: {
						ask: async (_: any, { prompt }: { prompt: string }) => {
							const response = await fetch('https://api.deepseek.com/v1/chat/completions', {
								method: 'POST',
								headers: {
									'Content-Type': 'application/json',
									Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
								},
								body: JSON.stringify({
									model: 'deepseek-chat',
									messages: [{ role: 'user', content: prompt }],
								}),
							});

							const data = (await response.json()) as DeepSeekResponse;

							// 使用类型安全的访问方式
							if (data.choices && data.choices.length > 0 && data.choices[0].message) {
								return data.choices[0].message.content;
							}

							return '无返回内容';
						},
					},
				},
			}),
			fetchAPI: { Request, Response }, // Cloudflare Workers 兼容性设置
			graphiql: !isProduction,
			// 确保GraphQL端点在/graphql路径
			graphqlEndpoint: '/graphql',
			// 添加logging
			logging: true,
		});

		try {
			const response = await yoga.fetch(request, env);
			const corsHeaders = getCORSHeaders(request, env);
			for (const [key, value] of Object.entries(corsHeaders)) {
				response.headers.set(key, value);
			}
			return response;
		} catch (error: any) {
			console.error('GraphQL处理错误:', error);
			return new Response(`处理请求时出错: ${error.message}`, {
				status: 500,
				headers: getCORSHeaders(request, env)
			});
		}
	},
};

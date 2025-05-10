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
	} else {
		// 添加默认允许的源，或使用 '*' 作为后备（如果适合你的使用场景）
		allowedOrigin = '*';
	}

	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
	};
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		// 添加请求URL和方法的日志
		console.log(`收到请求: ${request.method} ${request.url}`);

		// 获取URL和路径
		const url = new URL(request.url);
		const path = url.pathname;

		console.log(`请求路径: ${path}`);

		// 处理 CORS 预检请求 - 对所有路径返回CORS头
		if (request.method === 'OPTIONS') {
			return new Response(null, {
				status: 204,
				headers: getCORSHeaders(request, env),
			});
		}

		const isProduction = env.ENVIRONMENT === 'production';

		// 创建 GraphQL Yoga 实例
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
							console.log('处理查询：', prompt);

							try {
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

								if (!response.ok) {
									const errorText = await response.text();
									console.error('DeepSeek API 错误:', response.status, errorText);
									throw new Error(`DeepSeek API 错误: ${response.status} ${errorText}`);
								}

								const data = (await response.json()) as DeepSeekResponse;
								console.log('DeepSeek 响应:', JSON.stringify(data).substring(0, 100) + '...');

								// 使用类型安全的访问方式
								if (data.choices && data.choices.length > 0 && data.choices[0].message) {
									return data.choices[0].message.content;
								}

								return '无返回内容';
							} catch (error: any) {
								console.error('请求 DeepSeek API 时出错:', error);
								throw new Error(`处理请求时出错: ${error.message}`);
							}
						},
					},
				},
			}),
			landingPage: false, // 禁用默认的登陆页
			cors: false, // 禁用内置的 CORS 处理，我们自己处理
			graphiql: !isProduction, // 在非生产环境启用 GraphiQL
			graphqlEndpoint: path, // 使用请求的实际路径
			logging: true, // 启用日志记录
		});

		try {
			// 使用 yoga.fetch 处理请求
			const response = await yoga.fetch(request, {
				// 传递必要的上下文
				req: request,
				env,
				ctx,
			});

			// 确保应用 CORS 头
			const corsHeaders = getCORSHeaders(request, env);
			const newHeaders = new Headers(response.headers);

			for (const [key, value] of Object.entries(corsHeaders)) {
				newHeaders.set(key, value);
			}

			// 创建并返回带有 CORS 头的新响应
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers: newHeaders,
			});
		} catch (error: any) {
			console.error('GraphQL处理错误:', error);
			return new Response(
				JSON.stringify({
					errors: [{ message: `处理GraphQL请求时出错: ${error.message}` }],
				}),
				{
					status: 500,
					headers: {
						...getCORSHeaders(request, env),
						'Content-Type': 'application/json',
					},
				}
			);
		}
	},
};

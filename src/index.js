import puppeteer from '@cloudflare/puppeteer';

export default {
	async fetch(request, env) {
		console.log(`[BROWSER] === WORKER STARTED ===`);
		console.log(`[BROWSER] Request: ${request.method} ${request.url}`);
		console.log(`[BROWSER] Environment check - MYBROWSER: ${env.MYBROWSER ? 'AVAILABLE' : 'MISSING'}`);
		console.log(`[BROWSER] Environment check - BROWSER_KV_DEMO: ${env.BROWSER_KV_DEMO ? 'AVAILABLE' : 'MISSING'}`);
		try {
			const { searchParams } = new URL(request.url);
			let url = searchParams.get('url');
			let img;
			console.log(`[BROWSER] Extracted URL parameter: ${url}`);

			if (url) {
				console.log(`[BROWSER] URL parameter provided: ${url}`);
				// Add try-catch for URL normalization
				try {
					url = new URL(url).toString();
					console.log(`[BROWSER] Normalized URL: ${url}`);
				} catch (urlError) {
					console.error(`[BROWSER] Invalid URL provided: ${url}`, urlError);
					return new Response(`Invalid URL: ${urlError.message}`, { status: 400 });
				}

				console.log(`[BROWSER] Checking cache for URL...`);
				try {
					img = await env.BROWSER_KV_DEMO.get(url, { type: 'arrayBuffer' });
					console.log(`[BROWSER] Cache check result: ${img ? 'HIT' : 'MISS'}`);
				} catch (kvError) {
					console.error(`[BROWSER] KV cache access failed:`, kvError);
					img = null; // Continue without cache
				}

				if (img === null) {
					console.log(`[BROWSER] Cache miss - generating screenshot for: ${url}`);

					let browser;
					let page;
					try {
						console.log(`[BROWSER] Launching puppeteer with binding type: ${typeof env.MYBROWSER}`);
						if (!env.MYBROWSER) {
							throw new Error('MYBROWSER binding is not available');
						}
						browser = await puppeteer.launch(env.MYBROWSER);
						console.log(`[BROWSER] Browser launched successfully`);
						page = await browser.newPage();
						console.log(`[BROWSER] New page created`);

						console.log(`[BROWSER] Setting viewport to 1080x1080`);
						await page.setViewport({
							width: 1080,
							height: 1080,
							deviceScaleFactor: 2,
						});
						console.log(`[BROWSER] Viewport set successfully`);

						// Add timeout and better error handling for navigation
						console.log(`[BROWSER] Navigating to URL: ${url}`);
						try {
							// Test URL reachability first
							console.log(`[BROWSER] Testing URL reachability...`);
							const testResponse = await fetch(url, { method: 'HEAD' });
							console.log(`[BROWSER] URL test result: ${testResponse.status} ${testResponse.statusText}`);

							await page.goto(url, {
								waitUntil: 'networkidle0',
								timeout: 30000, // 30 seconds
							});
							console.log(`[BROWSER] Navigation completed successfully`);
						} catch (navError) {
							console.error(`[BROWSER] Navigation failed:`, navError);
							console.error(`[BROWSER] Navigation error type: ${navError.constructor.name}`);
							throw new Error(`Failed to navigate to URL: ${navError.message}`);
						}

						// More specific waiting with timeout
						console.log(`[BROWSER] Waiting for page content...`);
						try {
							// Check for SVG element
							await page.waitForSelector('svg', { timeout: 10000 });
							console.log(`[BROWSER] SVG element found`);

							// Log page info
							const pageTitle = await page.title();
							const svgCount = await page.$$eval('svg', (svgs) => svgs.length);
							console.log(`[BROWSER] Page title: "${pageTitle}", SVG count: ${svgCount}`);
						} catch (selectorError) {
							console.error(`[BROWSER] SVG element not found:`, selectorError);
							// Get page content for debugging
							try {
								const bodyHTML = await page.$eval('body', (el) => el.innerHTML.substring(0, 500));
								console.log(`[BROWSER] Page body (first 500 chars): ${bodyHTML}`);
							} catch (e) {
								console.log(`[BROWSER] Could not get page content`);
							}
							// Continue anyway
						}

						const MAX = 7_900_000; // 8 MB – a bit of head-room
						console.log('[BROWSER] Screenshot q100 …');
						img = await page.screenshot({ type: 'jpeg', quality: 100 });

						if (img.byteLength > MAX) {
							console.log(`[BROWSER] ${(img.byteLength / 1e6).toFixed(2)} MB > 7.9 MB → re-encode q80`);
							img = await page.screenshot({ type: 'jpeg', quality: 80 });
						}
						if (img.byteLength > MAX) {
							console.log(`[BROWSER] Still big → drop DPR to 1 & q85`);
							await page.setViewport({ width: 1080, height: 1080, deviceScaleFactor: 1 });
							img = await page.screenshot({ type: 'jpeg', quality: 85 });
						}
						console.log(`[BROWSER] Final JPEG ${(img.byteLength / 1e6).toFixed(2)} MB (${img.length} bytes)`);
						console.log(`[BROWSER] Caching screenshot...`);
						try {
							await env.BROWSER_KV_DEMO.put(url, img, {
								expirationTtl: 60 * 60 * 24,
							});
							console.log(`[BROWSER] Screenshot cached successfully`);
						} catch (cacheError) {
							console.error(`[BROWSER] Failed to cache screenshot:`, cacheError);
							// Continue anyway
						}
					} catch (screenshotError) {
						console.error(`[BROWSER] Screenshot generation failed:`, screenshotError);
						console.error(`[BROWSER] Screenshot error type: ${screenshotError.constructor.name}`);
						throw screenshotError;
					} finally {
						try {
							if (page) {
								await page.close();
								console.log('[BROWSER] Page closed successfully');
							}
							if (browser) {
								console.log('[BROWSER] Closing browser…');
								await browser.close();
								console.log('[BROWSER] Browser closed successfully');
							}
						} catch (cleanupError) {
							console.error('[BROWSER] Error during cleanup:', cleanupError);
						}
					}
				} else {
					console.log(`[BROWSER] Cache hit - returning cached image, size: ${img.length} bytes`);
				}

				console.log(`[BROWSER] Returning successful response, image size: ${img.length} bytes`);
				return new Response(img, {
					headers: {
						'content-type': 'image/jpeg',
						'x-browser-worker': 'success',
					},
				});
			} else {
				console.error(`[BROWSER] No URL parameter provided in request: ${request.url}`);
				return new Response('Please add an ?url=https://example.com/ parameter', {
					status: 400,
					headers: {
						'x-browser-worker': 'error-no-url',
					},
				});
			}
		} catch (error) {
			console.error('[BROWSER] === FATAL ERROR OCCURRED ===');
			console.error('[BROWSER] Error type:', error.constructor.name);
			console.error('[BROWSER] Error message:', error.message);
			console.error('[BROWSER] Full error object:', error);
			console.error('[BROWSER] Stack trace:', error.stack);
			console.error('[BROWSER] === END ERROR DETAILS ===');

			// Return more specific error messages
			if (error.message.includes('Worker threw exception')) {
				return new Response(`Browser worker crashed: ${error.message}`, {
					status: 500,
					headers: {
						'content-type': 'text/plain',
						'x-error-code': '1042',
					},
				});
			}

			return new Response(`Browser worker error: ${error.message}`, {
				status: 500,
				headers: {
					'content-type': 'text/plain',
				},
			});
		}
	},
};

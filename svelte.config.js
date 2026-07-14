import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		files: {
			assets: 'public'
		},
		adapter: adapter({
			pages: 'dist',
			assets: 'dist',
			fallback: '200.html',
			precompress: false,
			strict: true
		})
	}
};

export default config;

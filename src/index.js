import {
	start,
	loadConfig,
	loadSourceFiles,
	generatePages,
	savePages,
	paginate,
	orderDocuments,
	groupDocuments,
	createMarkdownRenderer,
	createTemplateRenderer,
	helpers as defaultHelpers,
} from 'fledermaus';
import visit from 'unist-util-visit';
import * as customHelpers from './helpers';

start('Building blog...');

let config = loadConfig('config');
let options = config.base;

function remarkScreenshot() {
	return ast => visit(ast, 'paragraph', node => {
		// Screenshots: /images/mac__shipit.png or /images/win__shipit.png
		let child = node.children && node.children[0];
		if (child && child.type === 'image') {
			let m = child.url.match(/\/(\w+)__/);
			if (m) {
				node.children = null;
				node.type = 'html';
				node.value =
					`<div class="screenshot screenshot_${m[1]}"><img src="${child.url}" alt="${child.title || ''}"></div>`;
			}
		}
	});
}
let renderMarkdown = createMarkdownRenderer({
	plugins: [remarkScreenshot],
});

let renderTemplate = createTemplateRenderer({
	root: options.templatesFolder,
});

let helpers = { ...defaultHelpers, ...customHelpers };

let documents = loadSourceFiles(options.sourceFolder, options.sourceTypes, {
	renderers: {
		md: renderMarkdown,
	},
	// Custom front matter field parsers
	fieldParsers: {
		// Save `date` field as a timestamp
		timestamp: (timestamp, attrs) => Date.parse(attrs.date),
		// Convert `date` field to a Date object
		date: date => new Date(Date.parse(date)),
		// Strip language (`en` or `ru`) from the URL (filename)
		url: url => url.replace(/(en|ru)\//, ''),
	},
	// Cut separator
	cutTag: options.cutTag,
});

// Oder by date, newest first
documents = orderDocuments(documents, ['-timestamp']);

// Group posts by language
let documentsByLanguage = groupDocuments(documents, 'lang');
let languages = Object.keys(documentsByLanguage);

documents = languages.reduce((result, lang) => {
	let docs = documentsByLanguage[lang];
	let newDocs = [];

	// Translations
	let translationLang = lang === 'ru' ? 'en' : 'ru';
	let hasTranslation = (url) => {
		return !!documentsByLanguage[translationLang].find(doc => doc.url === url);
	};
	docs = docs.map((doc) => {
		return {
			...doc,
			translation: hasTranslation(doc.url),
		};
	});

	// All posts page
	let postsByYear = groupDocuments(docs, doc => doc.date.getFullYear());
	let years = Object.keys(postsByYear);
	years.sort();
	years.reverse();
	newDocs.push({
		sourcePath: `${lang}/all`,
		url: '/all',
		translation: true,
		layout: 'all',
		postsTotal: docs.length,
		postsByYear,
		years,
		lang,
	});

	// Pagination
	newDocs.push(...paginate(docs, {
		sourcePathPrefix: lang,
		urlPrefix: '/',
		documentsPerPage: options.postsPerPage,
		layout: 'index',
		index: true,
		extra: {
			lang,
		},
	}));

	// Tags
	let postsByTag = groupDocuments(docs, 'tags');
	let tags = Object.keys(postsByTag);
	newDocs.push(...tags.reduce((tagsResult, tag) => {
		let tagDocs = postsByTag[tag];
		let tagsNewDocs = paginate(tagDocs, {
			sourcePathPrefix: `${lang}/tags/${tag}`,
			urlPrefix: `/tags/${tag}`,
			documentsPerPage: options.postsPerPage,
			layout: 'tag',
			extra: {
				lang,
				tag,
			},
		});
		return [...tagsResult, ...tagsNewDocs];
	}, []));

	// Atom feed
	newDocs.push({
		sourcePath: `${lang}/atom.xml`,
		url: '/atom.xml',
		layout: 'atom.xml',
		documents: docs.slice(0, options.postsInFeed),
		lang,
	});

	return [...result, ...docs, ...newDocs];
}, []);

let pages = generatePages(documents, config, helpers, { ect: renderTemplate });

savePages(pages, options.publicFolder);
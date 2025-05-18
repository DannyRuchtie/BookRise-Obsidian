import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting, requestUrl, TFolder, TFile } from 'obsidian';
import { BookriseClient, Book, Highlight } from './src/BookriseClient'; // Assuming BookriseClient.ts is in a src folder

// Define settings interface
interface BookrisePluginSettings {
	bookriseApiKey: string;
	bookriseSyncFolder: string; // Folder to sync BookRise notes into
	createNotePerHighlight: boolean; // New setting
	// We can add more settings here later, e.g., sync frequency, default folder for notes
}

const DEFAULT_SETTINGS: BookrisePluginSettings = {
	bookriseApiKey: '',
	bookriseSyncFolder: 'BookRise', // Default sync folder
	createNotePerHighlight: false // Default to false
}

export default class BookrisePlugin extends Plugin {
	settings: BookrisePluginSettings;
	client: BookriseClient | undefined; // Allow client to be undefined

	async onload() {
		await this.loadSettings();

		// Initialize the BookriseClient with the API key
		// We need to make sure the API key is set before using the client.
		// The client will be properly initialized after settings are loaded and validated.
		if (this.settings.bookriseApiKey) {
			this.client = new BookriseClient(this.settings.bookriseApiKey, requestUrl);
		} else {
			new Notice('BookRise API key not set. Please configure it in the plugin settings.');
			// client remains undefined
		}

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new BookriseSettingTab(this.app, this));

		// --- 1. Highlight Sync --- 
		// This creates an icon in the left ribbon.
		// const ribbonIconEl = this.addRibbonIcon('dice', 'BookRise Sync', (evt: MouseEvent) => {
		// 	// Called when the user clicks the icon.
		// 	new Notice('Syncing BookRise Highlights (Not Implemented Yet)!');
		// 	// this.syncHighlights(); 
		// });
		// // Perform additional things with the ribbon
		// ribbonIconEl.addClass('my-plugin-ribbon-class');

		// This adds a command that can be triggered anywhere
		this.addCommand({
			id: 'bookrise-sync-highlights',
			name: 'Sync BookRise Highlights',
			callback: async () => {
				if (!this.client) {
					new Notice('BookRise API key not set or client not initialized. Please configure it in the plugin settings.');
					return;
				}
				await this.syncAllHighlights();
			}
		});

		// --- 2. Chat Sidebar --- 
		// This adds a ribbon icon to open the chat sidebar
		this.addRibbonIcon('message-circle', 'Chat with BookRise Book', () => {
			if (!this.client) {
				new Notice('BookRise API key not set or client not initialized. Please configure it in the plugin settings.');
				return;
			}
			new Notice('Opening BookRise Chat Sidebar (Not Implemented Yet)!');
			// this.activateChatView(); // We will implement this function
		});

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)@
		// Using this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
		// 	console.log('click', evt);
		// });

		// When registering intervals, this function setInterval registers a global interval.
		// Best practice is to save the intervalID and clear it when the plugin is unloaded.
		// this.registerInterval(window.setInterval(() => console.log('setInterval'), 5 * 60 * 1000));
		console.log("BookRise Plugin Loaded");
	}

	onunload() {
		console.log("BookRise Plugin Unloaded");
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Re-initialize client if API key changes
		if (this.settings.bookriseApiKey) {
		    this.client = new BookriseClient(this.settings.bookriseApiKey, requestUrl);
		} else {
		    new Notice('BookRise API key has been cleared. Functionality requiring API access will be disabled.');
		    this.client = undefined; 
		}
	}

	// --- Highlight Sync Implementation ---
	async syncAllHighlights() {
		if (!this.client) {
			new Notice('BookRise client not available. Please check API key.');
			return;
		}

		new Notice('Starting BookRise highlight sync...', 5000);

		try {
			const books = await this.client.listBooks();
			if (!books || books.length === 0) {
				new Notice('No books found in your BookRise library.');
				return;
			}

			new Notice(`Found ${books.length} books. Fetching highlights...`, 5000);
			await this.ensureFolderExists(this.settings.bookriseSyncFolder);

			let successCount = 0;
			let errorCount = 0;

			for (const book of books) {
				try {
					await this.syncBookHighlights(book);
					successCount++;
				} catch (bookError) {
					console.error(`Failed to sync highlights for book: ${book.title}`, bookError);
					new Notice(`Error syncing ${book.title}. Check console.`);
					errorCount++;
				}
			}

			let summaryNotice = 'BookRise highlight sync finished.';
			if (successCount > 0) summaryNotice += ` Synced ${successCount} books.`;
			if (errorCount > 0) summaryNotice += ` Failed for ${errorCount} books.`;
			new Notice(summaryNotice);

		} catch (error) {
			console.error('Error during BookRise highlight sync:', error);
			new Notice('Error syncing BookRise highlights. Check console for details.');
		}
	}

	// Helper to sanitize file names
	sanitizeFileName(name: string): string {
		return name.replace(/[\/\\:\*\?\"\<\>\|]/g, '-').replace(/\s+/g, ' ');
	}

	async syncBookHighlights(book: Book) {
		if (!this.client) return;

		const bookFolderParent = this.settings.bookriseSyncFolder;
		const bookFolderName = this.sanitizeFileName(book.title);
		const bookFolderPath = `${bookFolderParent}/${bookFolderName}`.replace(/\/\//g, '/');
		await this.ensureFolderExists(bookFolderPath);

		const highlights = await this.client.listHighlights(book.id);
		
		// Always create/update the main book file first, regardless of highlight mode or if highlights exist
		const mainBookSanitizedTitle = this.sanitizeFileName(book.title);
		const mainBookFilePath = `${bookFolderPath}/${mainBookSanitizedTitle}.md`.replace(/\/\//g, '/');
		let mainBookContent = this.generateBookFrontmatter(book);
		mainBookContent += `# ${book.title}\n\n`;

		if (!highlights || highlights.length === 0) {
			console.log(`No highlights found for book: ${book.title}`);
			if (this.settings.createNotePerHighlight) {
				mainBookContent += 'No highlights found for this book.\n';
			} else {
				mainBookContent += `# Highlights for ${book.title}\n\n(No highlights found or synced for this book.)\n`;
			}
			await this.createOrUpdateFile(mainBookFilePath, mainBookContent);
			console.log(`Created/Updated main book file (no highlights) for: ${book.title} at ${mainBookFilePath}`);
			return;
		}

		console.log(`Processing ${highlights.length} highlights for book: ${book.title}`);

		if (this.settings.createNotePerHighlight) {
			// --- MODE: One note per highlight ---
			const highlightsFolder = `${bookFolderPath}/_Highlights`;
			await this.ensureFolderExists(highlightsFolder);

			mainBookContent += `This book's highlights are stored as individual notes in the "_Highlights" subfolder.

## Highlights Index\n`;
			const highlightLinks: string[] = [];

			for (const hl of highlights) {
				// console.log("Processing highlight object (for individual note):", JSON.stringify(hl, null, 2)); // Keep for debugging if needed
				const highlightIdSanitized = this.sanitizeFileName(hl.id);
				let noteTitlePrefix = 'Highlight';
				if (hl.text_content) {
					noteTitlePrefix = hl.text_content.trim().split(' ').slice(0, 5).join(' ');
				} else if (hl.note) {
					noteTitlePrefix = `Note - ${hl.note.trim().split(' ').slice(0, 4).join(' ')}`;
				}
				noteTitlePrefix = this.sanitizeFileName(noteTitlePrefix);

				const noteFileName = `${noteTitlePrefix} (${highlightIdSanitized.substring(0,8)}).md`;
				const noteFilePath = `${highlightsFolder}/${noteFileName}`.replace(/\/\//g, '/');
				
				let noteContent = this.generateHighlightNoteFrontmatter(hl, book, mainBookSanitizedTitle); // Pass main book title for linking back
				noteContent += this.formatSingleHighlightContent(hl);

				await this.createOrUpdateFile(noteFilePath, noteContent);
				console.log(`Created/Updated highlight note: ${noteFileName} for book ${book.title}`);
				// Use relative path for linking from main book note, assuming it's in parent folder
				highlightLinks.push(`- [[_Highlights/${noteFileName.replace(/\.md$/, '')}|${noteTitlePrefix} (${hl.color || 'highlight'})]]`);
			}
			mainBookContent += highlightLinks.join('\n') + '\n';
			await this.createOrUpdateFile(mainBookFilePath, mainBookContent);
			console.log(`Updated main book file with highlight links for: ${book.title}`);

		} else {
			// --- MODE: All highlights in one book file (existing logic) ---
			mainBookContent += `# Highlights for ${book.title}\n\n`; // Append to existing mainBookContent
			highlights.forEach(hl => {
				// console.log("Processing highlight object (for single file):", JSON.stringify(hl, null, 2)); // Keep for debugging
				mainBookContent += this.formatSingleHighlightAsListItem(hl);
			});
			await this.createOrUpdateFile(mainBookFilePath, mainBookContent);
			console.log(`Updated highlights file for: ${book.title} at ${mainBookFilePath}`);
		}
	}

	// Helper to generate YAML for the main book file
	generateBookFrontmatter(book: Book): string {
		let fm = '---\n';
		fm += `title: "${book.title.replace(/:/g, '-')}"\n`;
		fm += `id: ${book.id}\n`;

		const existingBookTags = book.tags || []; // Tags coming from BookRise for the book itself
		const pluginAddedTags = ['BookRise']; // Default tag added by the plugin
		if (book.author) {
			fm += `author: "${book.author}"\n`;
			const authorTag = book.author.replace(/[^a-zA-Z0-9\-_]/g, '_');
			pluginAddedTags.push(`author/${authorTag}`);
		}
		if (book.isbn) fm += `isbn: "${book.isbn}"\n`;
		if (book.percent_read !== undefined) fm += `percent_read: ${book.percent_read}\n`;
		
		// Combine tags from book data and plugin-added tags, ensuring uniqueness
		const allTags = Array.from(new Set([...existingBookTags, ...pluginAddedTags]));
		if (allTags.length > 0) {
		    fm += `tags: [${allTags.map(t => `"${t.replace(/:/g, '-')}"`).join(', ')}]\n`;
		}

		fm += 'source: BookRise\n'; // Changed from Markdown link to just text "BookRise"
		fm += '---\n\n';
		return fm;
	}

	// Helper to generate YAML for an individual highlight note
	generateHighlightNoteFrontmatter(hl: Highlight, book: Book, bookSanitizedFileNameForLink: string): string {
		let fm = '---\n';
		let noteTitle = 'BookRise Highlight';
		if (hl.text_content) {
			noteTitle = hl.text_content.trim().split(' ').slice(0, 7).join(' ');
			if (hl.text_content.trim().split(' ').length > 7) noteTitle += '...';
		} else if (hl.note) {
			noteTitle = `Note: ${hl.note.trim().split(' ').slice(0, 6).join(' ')}`;
			if (hl.note.trim().split(' ').length > 6) noteTitle += '...';
		}
		fm += `title: "${this.sanitizeFileName(noteTitle.replace(/:/g, '-'))}"\n`;
		fm += `book: "[[${bookSanitizedFileNameForLink}]]"\n`;
		fm += `book_id: ${book.id}\n`;
		fm += `highlight_id: ${hl.id}\n`;
		if (hl.color) fm += `color: ${hl.color}\n`;
		if (hl.page) fm += `page: ${hl.page}\n`;
		if (hl.location) fm += `location: "${hl.location}"\n`;
		if (hl.created_at) fm += `highlight_created_at: ${hl.created_at}\n`;

		const tags = ['BookRise', 'BookRiseHighlight']; // Keep these tags
		if (book.author) {
			const authorTag = book.author.replace(/[^a-zA-Z0-9\-_]/g, '_');
			tags.push(`author/${authorTag}`);
		}
		fm += `tags: [${tags.map(t => `"${t.replace(/:/g, '-')}"`).join(', ')}]\n`;
		// No separate source field for individual highlight notes, they inherit source via book and BookRise tag
		fm += '---\n\n';
		return fm;
	}

	// Helper to format a single highlight as a list item (used in one-file-per-book mode)
	formatSingleHighlightAsListItem(hl: Highlight): string {
		const blockId = hl.id ? hl.id.substring(0, 8) : Math.random().toString(36).substring(2, 10);
		const metadataParts = [];
		if (hl.page) metadataParts.push(`p. ${hl.page}`);
		if (hl.location) metadataParts.push(`loc. ${hl.location}`);
		if (hl.color) metadataParts.push(hl.color);
		const metadataString = metadataParts.length > 0 ? ` (${metadataParts.join(', ')})` : '';
		let primaryLineContent = '';
		let subNoteContent = '';

		if (hl.text_content) {
			primaryLineContent = hl.text_content.replace(/\n/g, '\n  '); 
			if (hl.note) {
				subNoteContent = `  - **Note:** ${hl.note.replace(/\n/g, '\n    ')}\n`;
			}
		} else if (hl.note) {
			primaryLineContent = `**Note:** ${hl.note.replace(/\n/g, '\n  ')}`;
		} else {
			primaryLineContent = '';
		}
		let finalPrimaryLine = primaryLineContent.trim() + metadataString;
		if (finalPrimaryLine.length === 0 && metadataString.length === 0) {
			finalPrimaryLine = " "; 
		}
		let listItem = `- ${finalPrimaryLine.trim()} ^${blockId}\n`;
		if (subNoteContent) {
			listItem += subNoteContent;
		}
		listItem += '\n'; 
		return listItem;
	}

	// Helper to format content for an individual highlight note file
	formatSingleHighlightContent(hl: Highlight): string {
		let content = '';
		if (hl.text_content) {
			content += `${hl.text_content}\n\n`;
		}
		if (hl.note) {
			content += `**Note:**\n${hl.note}\n\n`;
		}
		// Can add color, page, location as text if not purely in YAML
		if (!hl.text_content && !hl.note) {
		    content += "(This highlight has no text or note content from BookRise.)\n";
		}
		return content;
	}

	// Helper to create or update a file
	async createOrUpdateFile(filePath: string, content: string): Promise<void> {
		const existingFile = this.app.vault.getAbstractFileByPath(filePath);
		if (existingFile && existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, content);
		} else {
			await this.app.vault.create(filePath, content);
		}
	}

	// Helper function to ensure a folder exists
	async ensureFolderExists(folderPath: string): Promise<void> {
		try {
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (!folder) {
				await this.app.vault.createFolder(folderPath);
				console.log(`Created folder: ${folderPath}`);
			} else if (!(folder instanceof TFolder)) {
                new Notice(`Error: ${folderPath} exists but is a file, not a folder.`);
                throw new Error(`${folderPath} exists but is a file, not a folder.`);
            }
		} catch (error) {
			console.error(`Error ensuring folder ${folderPath} exists:`, error);
            // Decide if this error is critical. For now, let it be caught by the calling function.
            if (error instanceof Error && !error.message.includes("Folder already exists")) {
                 throw error; // Re-throw if it's not a "folder already exists" type of error (which createFolder might throw on some systems/setups)
            }
		}
	}

	// async activateChatView() { /* ... */ }
}

// Settings Tab Implementation
class BookriseSettingTab extends PluginSettingTab {
	plugin: BookrisePlugin;

	constructor(app: App, plugin: BookrisePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		containerEl.createEl('h2', {text: 'BookRise Sync Settings'});

		new Setting(containerEl)
			.setName('BookRise API Key')
			.setDesc('Enter your BookRise API key to sync highlights and use chat.')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.bookriseApiKey)
				.onChange(async (value) => {
					this.plugin.settings.bookriseApiKey = value;
					await this.plugin.saveSettings();
				}));
        
        new Setting(containerEl)
            .setName('BookRise Sync Folder')
            .setDesc('The folder where BookRise notes and highlights will be saved.')
            .addText(text => text
                .setPlaceholder('e.g., BookRise Notes')
                .setValue(this.plugin.settings.bookriseSyncFolder)
                .onChange(async (value) => {
                    this.plugin.settings.bookriseSyncFolder = value || DEFAULT_SETTINGS.bookriseSyncFolder;
                    await this.plugin.saveSettings();
                }));

		// Add the new setting toggle
		new Setting(containerEl)
			.setName('Create individual note per highlight')
			.setDesc('If enabled, each highlight will be saved as a separate note. Otherwise, all highlights for a book are saved in one file.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.createNotePerHighlight)
				.onChange(async (value) => {
					this.plugin.settings.createNotePerHighlight = value;
					await this.plugin.saveSettings();
				}));
	}
}

// Note: We need to replace `fetch` in `BookriseClient.ts` with `requestUrl` from Obsidian API
// for it to work correctly within an Obsidian plugin environment due to CORS and other considerations.
// I will do this as a next step. 
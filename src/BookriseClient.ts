// Define interfaces for API data structures
export interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  tags?: string[];
  percent_read?: number;
  // Add other book properties as needed from the API response
}

export interface Highlight {
  id: string;
  book_id?: string;
  user_id?: string;
  cfi_range?: string;
  text_content?: string;
  page?: number;
  location?: string;
  color?: string;
  note?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ChatResponse {
  answer: string;
  cited_paragraph_ids: string[]; // Or however the citations are structured
  // Add other potential response fields
}

// Define a type for the requestUrl function from Obsidian API
// This helps in making BookriseClient testable outside Obsidian if needed
// and clearly defines the dependency.
export type RequestUrlFunc = (options: { url: string; method?: string; headers?: Record<string, string>; body?: string; }) => Promise<{ status: number; text: string; json: any; }>;

export class BookriseClient {
  private baseUrl = "https://app.bookrise.io/api"; // Removed /v1

  constructor(private token: string, private requestUrlFn: RequestUrlFunc) {}

  private async request<T>(endpoint: string, options: { method?: string; headers?: Record<string, string>; body?: string; } = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const requestOptions = {
      url,
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
      body: options.body,
    };

    console.log(`Requesting: ${requestOptions.method} ${url}`);
    // Use the passed-in requestUrlFn
    const response = await this.requestUrlFn(requestOptions);

    // Log raw response for specific endpoints if needed for debugging
    if (endpoint === "/books") {
      console.log("Raw /books API response text:", response.text);
    }

    // requestUrl typically throws on non-2xx status codes, but we can double-check
    // However, the structure of requestUrl's response is { status, text, json, etc. }
    // The `text` field contains the raw response body for parsing.
    if (response.status < 200 || response.status >= 300) {
        // Attempt to parse error from response.text if available, or use a generic message
        let errorBody = response.text;
        try {
            const parsedError = JSON.parse(response.text);
            errorBody = parsedError.detail || response.text; // Example: FastAPI error format
        } catch (e) {
            // Not JSON or different error structure
        }
        console.error(`API Error: ${response.status}`, errorBody);
        throw new Error(`Error calling BookRise API: Status ${response.status} - ${errorBody}`);
    }

    const responseText = response.text;
    if (!responseText && response.status !== 204) { // Allow empty response for 204 No Content
        console.warn(`Empty response for status ${response.status} from ${url}`);
        return null as T; // Or throw an error if an empty response is unexpected
    }
    if (response.status === 204) { // Handle 204 No Content explicitly
        return null as T;
    }

    return JSON.parse(responseText) as T;
  }

  async listBooks(): Promise<Book[]> {
    return this.request<Book[]>("/books");
  }

  async listHighlights(bookId: string): Promise<Highlight[]> {
    if (!bookId) {
      throw new Error("bookId is required to list highlights.");
    }
    return this.request<Highlight[]>(`/highlights?book_id=${bookId}`);
  }

  // GET /highlights/{id} is also mentioned in the notes, could be added if needed
  // async getHighlightDetails(highlightId: string): Promise<Highlight> {
  //   return this.request<Highlight>(`/highlights/${highlightId}`);
  // }

  async chat(bookId: string, prompt: string, contextIds?: string[]): Promise<ChatResponse> {
    if (!bookId || !prompt) {
      throw new Error("bookId and prompt are required for chat.");
    }
    const body: { book_id: string; prompt: string; context_ids?: string[] } = {
      book_id: bookId,
      prompt,
    };
    if (contextIds && contextIds.length > 0) {
      body.context_ids = contextIds;
    }

    // Special case for the chat endpoint if it's not under /api
    const chatUrl = "https://app.bookrise.io/chat"; 

    console.log(`Requesting: POST ${chatUrl} with book_id: ${bookId}`);
    
    // Directly use requestUrlFn for this special case to bypass baseUrl prefixing
    const response = await this.requestUrlFn({
      url: chatUrl,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (response.status < 200 || response.status >= 300) {
      let errorBody = response.text;
      try {
        const parsedError = JSON.parse(response.text);
        errorBody = parsedError.detail || response.text;
      } catch (e) {
        // Not JSON
      }
      console.error(`API Error for chat: ${response.status}`, errorBody);
      throw new Error(`Error calling BookRise chat: Status ${response.status} - ${errorBody}`);
    }

    const responseText = response.text;
    if (!responseText && response.status !== 204) {
      console.warn(`Empty response for chat status ${response.status} from ${chatUrl}`);
      return { answer: "Received empty response." } as ChatResponse; // Provide a default ChatResponse
    }
    if (response.status === 204) {
      return { answer: "Chat session updated (No Content)." } as ChatResponse; // Provide a default ChatResponse
    }
    
    // Assuming the response is JSON and matches ChatResponse structure
    // If it's streaming, this will need to change significantly.
    return JSON.parse(responseText) as ChatResponse;
  }

  // Placeholder for GET /reading-queue (for feature #3)
  // async getReadingQueue(): Promise<any> { // Replace 'any' with actual type
  //   return this.request<any>("/reading-queue");
  // }

  // Placeholder for GET /progress (for feature #3)
  // async getProgress(): Promise<any> { // Replace 'any' with actual type
  //   return this.request<any>("/progress");
  // }
  
  // Placeholder for GET /highlights?since= (for feature #4)
  // async getRecentHighlights(sinceDate: string): Promise<Highlight[]> {
  //   return this.request<Highlight[]>(`/highlights?since=${sinceDate}`);
  // }

  // Placeholder for POST /highlights (for feature #5)
  // async createHighlight(bookId: string, text: string, page?: number, location?: string, color?: string): Promise<Highlight> {
  //   const body = { book_id: bookId, text, page, location, color };
  //   return this.request<Highlight>("/highlights", {
  //     method: "POST",
  //     body: JSON.stringify(body),
  //   });
  // }
}

// Example usage (for testing outside Obsidian):
// async function main() {
//   if (typeof process === 'undefined' || !process.env.BOOKRISE_TOKEN) {
//     console.log("BOOKRISE_TOKEN environment variable not set. Skipping example usage.");
//     return;
//   }
//   const client = new BookriseClient(process.env.BOOKRISE_TOKEN);
//   try {
//     console.log("Fetching books...");
//     const books = await client.listBooks();
//     console.log("Books:", books.length > 0 ? books[0] : 'No books found');

//     if (books.length > 0) {
//       console.log(`Fetching highlights for book ID: ${books[0].id}...`);
//       const highlights = await client.listHighlights(books[0].id);
//       console.log("Highlights:", highlights.length > 0 ? highlights[0] : 'No highlights found');

//       console.log(`Attempting chat for book ID: ${books[0].id}...`);
//       const chatResponse = await client.chat(books[0].id, "What is the main theme?");
//       console.log("Chat Response:", chatResponse);
//     }
//   } catch (error) {
//     console.error("Error during API client test:", error);
//   }
// }

// main(); 
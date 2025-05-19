// Define interfaces for API data structures
export interface Book {
  id: string;
  title: string;
  author?: string;
  isbn?: string;
  tags?: string[];
  percent_read?: number;
  assistant_id?: string;
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
  cited_chapters?: number[]; // Added to capture cited_chapters
}

// Define a type for the requestUrl function from Obsidian API
// This helps in making BookriseClient testable outside Obsidian if needed
// and clearly defines the dependency.
export type RequestUrlFunc = (options: { url: string; method?: string; headers?: Record<string, string>; body?: string; }) => Promise<{ status: number; text: string; json: any; }>;

export class BookriseClient {
  private baseUrl = "https://app.bookrise.io"; // Remove /api since it's part of the endpoint

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
    return this.request<Book[]>("/api/books");
  }

  async listHighlights(bookId: string): Promise<Highlight[]> {
    if (!bookId) {
      throw new Error("bookId is required to list highlights.");
    }
    return this.request<Highlight[]>(`/api/highlights?book_id=${bookId}`);
  }

  // GET /highlights/{id} is also mentioned in the notes, could be added if needed
  // async getHighlightDetails(highlightId: string): Promise<Highlight> {
  //   return this.request<Highlight>(`/highlights/${highlightId}`);
  // }

  async chat(bookId: string, prompt: string, contextIds?: string[], onChunk?: (chunk: string) => void): Promise<ChatResponse> {
    if (!bookId || !prompt) {
      throw new Error("bookId and prompt are required for chat.");
    }

    // Get the book details first to ensure we have the correct assistant_id
    const books = await this.listBooks();
    const book = books.find(b => b.id === bookId);
    
    if (!book) {
      throw new Error(`Book with ID ${bookId} not found`);
    }

    // Use the correct endpoint without /api prefix
    const endpoint = "/chat";
    
    try {
      console.log(`Attempting chat request to: ${this.baseUrl}${endpoint}`);
      
      const body = {
        book_id: bookId,
        message: prompt,
        context_ids: contextIds || []
      };

      // If we have an onChunk callback, use streaming
      if (onChunk) {
        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream'
          },
          body: JSON.stringify(body)
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Chat API error: ${response.status} - ${errorText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Failed to get response reader');
        }

        let fullAnswer = '';
        const decoder = new TextDecoder();
        let citedChapters: number[] = []; // Variable to store cited chapters

        while (true) {
          const { done, value } = await reader.read();
          console.log(`Stream reader: done = ${done}, value length = ${value ? value.byteLength : 'undefined'}`);

          if (done) break;

          const chunk = decoder.decode(value, { stream: true }); // Use {stream: true} for TextDecoder
          console.log("Raw stream chunk decoded:", chunk);

          const lines = chunk.split('\n');
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              
              try {
                const parsed = JSON.parse(data);
                console.log("Parsed stream data chunk:", JSON.stringify(parsed)); // Log the parsed chunk
                if (parsed.content) { // THIS IS THE KEY CHANGE
                  fullAnswer += parsed.content;
                  onChunk(parsed.content);
                } else if (parsed.answer) { 
                  fullAnswer += parsed.answer;
                  onChunk(parsed.answer);
                } else if (parsed.delta) { 
                  fullAnswer += parsed.delta;
                  onChunk(parsed.delta);
                } else if (typeof parsed === 'string') { 
                  fullAnswer += parsed;
                  onChunk(parsed);
                }

                if (parsed.cited_chapters && Array.isArray(parsed.cited_chapters)) {
                  citedChapters = citedChapters.concat(parsed.cited_chapters);
                }

                if (parsed.done && parsed.status === "completed") {
                  // Optional: Could break here if [DONE] is not always sent separately
                  // but the main loop condition `if (done) break;` should handle it.
                }

              } catch (e) {
                console.warn('Failed to parse chunk:', e);
              }
            }
          }
        }

        return {
          answer: fullAnswer,
          cited_paragraph_ids: [], // TODO: Get citations from stream (still to be refined if paragraph_ids are different from chapters)
          cited_chapters: Array.from(new Set(citedChapters)) // Store unique chapter numbers
        };
      }

      // Non-streaming fallback
      const response = await this.request<ChatResponse>(endpoint, {
        method: "POST",
        body: JSON.stringify(body)
      });

      if (!response) {
        throw new Error("Received empty response from chat API");
      }

      return response;

    } catch (error) {
      console.error(`Error with chat endpoint ${endpoint}:`, error);
      throw new Error(`Failed to get chat response: ${error.message}`);
    }
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
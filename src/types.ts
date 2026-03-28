export type Mode = 'standard' | 'advanced' | 'expert';

export type ExtensionSettings = {
  backendBaseUrl: string;
  apiKey: string;
  mode: Mode;
};

export type ExtractedReview = {
  reviewExternalId: string;
  productName: string | null;
  rating: number | null;
  reviewText: string | null;
  reviewDate: string | null;
  authorName: string | null;
  existingSellerReply: string | null;
  pageUrl: string;
  domContext?: Record<string, unknown>;
};

export type ReviewUiState = {
  reviewExternalId: string;
  reviewLogId?: string;
  generatedReply?: string;
  matched?: boolean;
  warning?: string | null;
  status:
    | 'idle'
    | 'extracting'
    | 'sending'
    | 'generated'
    | 'inserting'
    | 'inserted'
    | 'error'
    | 'skipped';
  errorText?: string | null;
};

export type GenerateReplyPayload = ExtractedReview & {
  marketplace: 'ozon';
  mode: Mode;
};

export type GenerateReplyResponse = {
  reviewLogId: string;
  generatedReply: string;
  matchedProduct?: {
    matched: boolean;
    confidence?: number;
    productId?: string;
    productName?: string;
    article?: string;
  } | null;
  warnings?: string[];
  canAutopost?: boolean;
  model?: string;
};

export type CheckAuthResponse = {
  valid: boolean;
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
  defaults?: {
    tonePreset?: string | null;
    toneNotes?: string | null;
  };
  limits?: {
    mode?: Mode[];
  };
};

export type ReplyResultPayload = {
  reviewLogId: string;
  status: 'inserted' | 'failed' | 'skipped';
  finalReply?: string;
  errorText?: string;
};

export type BackgroundRequest =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<ExtensionSettings> }
  | { type: 'CHECK_CONNECTION' }
  | { type: 'GENERATE_REPLY'; payload: GenerateReplyPayload }
  | { type: 'REPORT_RESULT'; payload: ReplyResultPayload };

export type BackgroundResponse<T = unknown> = {
  ok: boolean;
  data?: T;
  error?: string;
};

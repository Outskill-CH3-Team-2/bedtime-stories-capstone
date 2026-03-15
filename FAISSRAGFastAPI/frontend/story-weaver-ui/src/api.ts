import axios from 'axios'

const api = axios.create({ baseURL: '', timeout: 30_000 })

// Sanitize error messages — strip internal paths/stack traces before showing to users
export function sanitizeError(e: unknown): string {
  const msg: string =
    (e as any)?.response?.data?.detail ??
    (e as any)?.message ??
    'An unexpected error occurred.'
  // Drop anything that looks like a file path or Python traceback
  if (msg.includes('Traceback') || msg.includes('File "') || msg.length > 300) {
    return 'The server returned an error. Please try again.'
  }
  return msg
}

// ── Shared types ──────────────────────────────────────────────────────────

export interface RootStatus {
  status: string
  service: string
  version: string
  mock_mode: boolean
  rag_status: string
}

export interface HealthStatus {
  status: string
  rag_available: boolean
  rag_model_status?: string
  indexed_chunks?: number
  rag_import_error?: string
  fix?: string
  detail?: string
}

export interface GenerateResponse {
  session_id: string
  job_id: string
}

export interface JobStatus {
  status: string
  job_id: string
  session_id: string
}

export interface Choice {
  id: string
  text: string
  audio_b64: string
  image_b64: string
}

export interface SceneOutput {
  session_id: string
  step_number: number
  is_ending: boolean
  story_text: string
  narration_audio_b64: string
  illustration_b64: string
  choices: Choice[]
  generation_time_ms: number
  safety_passed: boolean
}

export interface UploadResponse {
  file_id: string
  chunks: number
}

export interface Personalization {
  favourite_colour?: string
  favourite_animal?: string
  favourite_food?: string
  favourite_activities?: string[]
  pet_name?: string
  pet_type?: string
  place_to_visit?: string
}

export interface ChildConfig {
  child_name: string
  child_age: number
  voice?: string
  personalization?: Personalization
}

export interface StoryRequest {
  prompt: string
  age_group?: string
  story_length?: string
  child_name?: string
  voice?: string
}

export interface SttDebugResponse {
  job_id: string
  word_overlap_pct: number
  match: boolean | null
  skipped?: boolean
  reason?: string
}


export interface DeleteFileResponse {
  file_id: string
  chunks_removed: number
}

// ── API calls ─────────────────────────────────────────────────────────────

export const getRoot    = () => api.get<RootStatus>('/').then(r => r.data)
export const getHealth  = () => api.get<HealthStatus>('/health').then(r => r.data)

export const storyGenerate = (body: {
  config?: ChildConfig
  story_idea?: string
  session_id?: string
  choice_text?: string
  prev_job_id?: string
  prev_choice_text?: string
}) => api.post<GenerateResponse>('/story/generate', body).then(r => r.data)

export const getJobStatus  = (id: string) => api.get<JobStatus>(`/story/status/${id}`).then(r => r.data)
export const getJobResult  = (id: string) => api.get<SceneOutput>(`/story/result/${id}`).then(r => r.data)

export const ragGenerate   = (body: StoryRequest) => api.post<GenerateResponse>('/api/v1/generate', body).then(r => r.data)

export const uploadFile = async (file: File): Promise<UploadResponse> => {
  const fd = new FormData()
  fd.append('file', file)
  // Upload + parse + embed + FAISS index can take several minutes for large files
  const res = await api.post<UploadResponse>('/api/v1/upload', fd, { timeout: 600_000 })
  return res.data
}

export const debugStt = (audio_b64: string, job_id = '', story_text = '') =>
  api.post<SttDebugResponse>('/story/debug/stt', { audio_b64, job_id, story_text }).then(r => r.data)

export const deleteFile = (fileId: string) =>
  api.delete<DeleteFileResponse>(`/api/v1/upload/${fileId}`).then(r => r.data)


// ── Polling helper ────────────────────────────────────────────────────────

export async function pollUntilDone(
  jobId: string,
  onStatus: (s: string) => void,
  intervalMs = 1500,
  timeoutMs  = 180_000,
  signal?: AbortSignal,
): Promise<SceneOutput> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new DOMException('Polling cancelled', 'AbortError')
    const { status } = await getJobStatus(jobId)
    onStatus(status)
    if (status === 'complete') return getJobResult(jobId)
    if (status === 'failed')   throw new Error('Pipeline reported status: failed')
    await new Promise<void>((resolve, reject) => {
      const tid = setTimeout(resolve, intervalMs)
      signal?.addEventListener('abort', () => { clearTimeout(tid); reject(new DOMException('Polling cancelled', 'AbortError')) }, { once: true })
    })
  }
  throw new Error('Polling timed out after 3 minutes')
}

# Future Optimizations & Roadmap

## Performance Optimizations

### Bull/Redis Worker Queue
The current media processing uses in-process `worker_threads`. For production-scale workloads (processing 10,000+ images or long video files simultaneously), consider migrating to Bull + Redis:
- **Bull** provides persistent job queues with retry, priority, and rate limiting
- **Redis** as the backing store enables multi-process workers
- Jobs can survive server restarts
- Dashboard UI via Bull Board

### Parallel Processing
- Process multiple media files in parallel with configurable concurrency
- Use sharp's pipeline mode for batch image thumbnailing
- Implement streaming upload for large video files

---

## Cloud Storage Providers

### S3 Provider
```typescript
class S3StorageProvider implements StorageProvider {
  // Store files in S3 buckets
  // Pre-signed URLs for secure serving
  // Lifecycle policies for cost management
}
```

### UploadThing Provider
- Integrate with UploadThing for managed file uploads
- Automatic CDN distribution

### Google Cloud Storage
- GCS bucket integration
- Cloud CDN for low-latency serving

---

## Marketplace Subscription System

### Architecture
1. **Remote Registry API** (Larkup Hub):
   - Hosted tool catalog with versioning
   - Subscription validation via license keys
   - Usage metering and billing integration
   
2. **Pricing Tiers**:
   - `free`: Always available, no restrictions
   - `pro`: Requires active subscription ($X/mo)
   - `enterprise`: Custom pricing, SLA, priority support

3. **Implementation**:
   - `ToolDescriptor.requiresSubscription` flag
   - License key validation on install
   - Periodic subscription status check
   - Graceful degradation on expiry (tool still installed but disabled)

### Revenue Model Ideas
- Per-tool subscription (individual tool pricing)
- Bundle pricing (all pro tools for one price)
- Usage-based (pay per minute of video processed, per image captioned)
- Freemium with limits (e.g., 100 images free, then subscription)

---

## API Gateway / Proxy Server

### Purpose
A centralized API gateway to power the marketplace at scale. Currently all tracking is local; this service would enable:
- **Remote tool registry** — serve tool manifests from a central catalog / CDN
- **Download/install count tracking** — server-side counters (not local-only)
- **Pricing & subscription validation** — free vs pro vs enterprise tier enforcement
- **License key verification** — validate paid tools on install
- **Tool version checks** — notify users of available updates
- **Rate limiting & abuse prevention** — protect against malicious installs
- **Analytics** — track tool popularity, usage patterns, error rates

### Possible Stack
- **Hono on Cloudflare Workers** (lightweight, edge-deployed)
- **Alternatively**: Express/Fastify on a VPS, or a serverless function (Vercel/AWS Lambda)
- **Storage**: Turso (SQLite) or Planetscale for tool metadata + download counts
- **CDN**: Serve tool icon images via Cloudflare R2 or S3

### Endpoints (Draft)
```
GET    /v1/tools              → list all available tools
GET    /v1/tools/:id          → get tool details + download count
POST   /v1/tools/:id/install  → increment download counter
POST   /v1/license/validate   → validate license key for paid tools
GET    /v1/tools/:id/icon     → serve tool icon image from CDN
```

---

## CLIP/SigLIP Native Embeddings

### What It Enables
- Direct image-to-image similarity search
- Text-to-image search via shared embedding space
- No captioning needed for basic image retrieval

### Implementation Path
1. Integrate `open-clip-torch` or `@xenova/transformers` (JS)
2. Add CLIP vector dimension alongside text embeddings in vector store
3. Multi-vector index: text vectors + CLIP vectors
4. Hybrid search: combine text similarity + visual similarity scores
5. UI: drag-and-drop query image for visual search

### Estimated Model Sizes
- ViT-B/32: ~340MB
- ViT-L/14: ~900MB  
- SigLIP ViT-B/16: ~360MB (recommended for accuracy/speed tradeoff)

---

## Additional Future Features

### Real-time Audio Transcription
- Stream microphone input directly to Whisper
- Live captioning and indexing during meetings/calls

### Video Scene Segmentation
- AI-powered scene boundary detection
- Automatic chapter markers
- Per-scene captioning instead of fixed-interval frames

### Batch Re-processing
- Re-caption all media when switching vision models
- Re-embed with different embedding model
- Bulk update metadata

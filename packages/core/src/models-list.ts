import type { GatewayModel } from "./models-cache";

export const ALL_MODELS: GatewayModel[] = [
  {
    "id": "alibaba/qwen-3-14b",
    "name": "Qwen3-14B",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3 is the latest generation of large language models in Qwen series, offering a comprehensive suite of dense and mixture-of-experts (MoE) models. Built upon extensive training, Qwen3 delivers groundbreaking advancements in reasoning, instruction-following, agent capabilities, and multilingual support",
    "context_window": 40960,
    "max_tokens": 16384,
    "tags": [
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen-3-235b",
    "name": "Qwen3 235B A22B",
    "owned_by": "alibaba",
    "type": "language",
    "description": "",
    "context_window": 262144,
    "max_tokens": 16384,
    "tags": [
      "tool-use",
      "reasoning"
    ]
  },
  {
    "id": "alibaba/qwen-3-30b",
    "name": "Qwen3-30B-A3B",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3 is the latest generation of large language models in Qwen series, offering a comprehensive suite of dense and mixture-of-experts (MoE) models. Built upon extensive training, Qwen3 delivers groundbreaking advancements in reasoning, instruction-following, agent capabilities, and multilingual support",
    "context_window": 40960,
    "max_tokens": 16384,
    "tags": [
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen-3-32b",
    "name": "Qwen 3 32B",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3-32B is a world-class model with comparable quality to DeepSeek R1 while outperforming GPT-4.1 and Claude Sonnet 3.7. It excels in code-gen, tool-calling, and advanced reasoning, making it an exceptional model for a wide range of production use cases.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "alibaba/qwen-3.6-max-preview",
    "name": "Qwen 3.6 Max Preview",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Compared with the previously released Qwen3-Max and Qwen3.6-Plus, this model features enhanced vibe coding abilities, more efficient coding agent execution, and significantly improved front-end development skills. Additionally, its long-tail knowledge retention has been further upgraded.",
    "context_window": 240000,
    "max_tokens": 64000,
    "tags": [
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3-235b-a22b-thinking",
    "name": "Qwen3 VL 235B A22B Thinking",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3 series VL models feature significantly enhanced multimodal reasoning capabilities, with a particular focus on optimizing the model for STEM and mathematical reasoning. Visual perception and recognition abilities have been comprehensively improved, and OCR capabilities have undergone a major upgrade.",
    "context_window": 131072,
    "max_tokens": 32768,
    "tags": [
      "vision",
      "reasoning",
      "tool-use",
      "file-input"
    ]
  },
  {
    "id": "alibaba/qwen3-coder",
    "name": "Qwen3 Coder 480B A35B Instruct",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3-Coder-480B-A35B-Instruct is a cutting-edge open coding model from Qwen, matching Claude Sonnet’s performance in agentic programming, browser automation, and core development tasks.",
    "context_window": 262144,
    "max_tokens": 65536,
    "tags": [
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "alibaba/qwen3-coder-30b-a3b",
    "name": "Qwen 3 Coder 30B A3B Instruct",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Efficient coding specialist balancing performance with cost-effectiveness for daily development tasks while maintaining strong tool integration capabilities.",
    "context_window": 262144,
    "max_tokens": 8192,
    "tags": [
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3-coder-next",
    "name": "Qwen3 Coder Next",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3-Coder-Next is an open-weight language model built specifically for coding, with strong performance on large-scale software engineering and agentic coding benchmarks. It uses a hybrid Mixture-of-Experts architecture to offer high capability at relatively modest active parameter counts, improving efficiency for real-world deployments. The model is trained on diverse code and natural language data so it can handle tasks like code generation, refactoring, debugging, repository-level reasoning, and technical explanation across multiple programming languages. It is also optimized for tool use and function calling, making it suitable as the core of coding agents that interact with shells, editors, issue trackers, and other developer tools.",
    "context_window": 256000,
    "max_tokens": 256000,
    "tags": [
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3-coder-plus",
    "name": "Qwen3 Coder Plus",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Powered by Qwen3 this is a powerful Coding Agent that excels in tool calling and environment interaction to achieve autonomous programming. It combines outstanding coding proficiency with versatile general-purpose abilities.",
    "context_window": 1000000,
    "max_tokens": 65536,
    "tags": [
      "implicit-caching",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3-embedding-0.6b",
    "name": "Qwen3 Embedding 0.6B",
    "owned_by": "alibaba",
    "type": "embedding",
    "description": "The Qwen3 Embedding model series is the latest proprietary model of the Qwen family, specifically designed for text embedding and ranking tasks. Building upon the dense foundational models of the Qwen3 series, it provides a comprehensive range of text embeddings and reranking models in various sizes (0.6B, 4B, and 8B).",
    "context_window": 32768,
    "max_tokens": 32768,
    "tags": []
  },
  {
    "id": "alibaba/qwen3-embedding-4b",
    "name": "Qwen3 Embedding 4B",
    "owned_by": "alibaba",
    "type": "embedding",
    "description": "The Qwen3 Embedding model series is the latest proprietary model of the Qwen family, specifically designed for text embedding and ranking tasks. Building upon the dense foundational models of the Qwen3 series, it provides a comprehensive range of text embeddings and reranking models in various sizes (0.6B, 4B, and 8B).",
    "context_window": 32768,
    "max_tokens": 32768,
    "tags": []
  },
  {
    "id": "alibaba/qwen3-embedding-8b",
    "name": "Qwen3 Embedding 8B",
    "owned_by": "alibaba",
    "type": "embedding",
    "description": "The Qwen3 Embedding model series is the latest proprietary model of the Qwen family, specifically designed for text embedding and ranking tasks. Building upon the dense foundational models of the Qwen3 series, it provides a comprehensive range of text embeddings and reranking models in various sizes (0.6B, 4B, and 8B).",
    "context_window": 32768,
    "max_tokens": 32768,
    "tags": []
  },
  {
    "id": "alibaba/qwen3-max",
    "name": "Qwen3 Max",
    "owned_by": "alibaba",
    "type": "language",
    "description": "The Qwen 3 series Max model has undergone specialized upgrades in agent programming and tool invocation compared to the preview version. The officially released model this time has achieved state-of-the-art (SOTA) performance in its field and is better suited to meet the demands of agents operating in more complex scenarios.",
    "context_window": 262144,
    "max_tokens": 32768,
    "tags": [
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "alibaba/qwen3-max-preview",
    "name": "Qwen3 Max Preview",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3-Max-Preview shows substantial gains over the 2.5 series in overall capability, with significant enhancements in Chinese-English text understanding, complex instruction following, handling of subjective open-ended tasks, multilingual ability, and tool invocation; model knowledge hallucinations are reduced.",
    "context_window": 262144,
    "max_tokens": 32768,
    "tags": [
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "alibaba/qwen3-max-thinking",
    "name": "Qwen 3 Max Thinking",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Compared with the snapshot as of September 23, 2025, the Qwen-3 series Max model in this release achieves an effective integration of thinking and non-thinking modes, resulting in a comprehensive and substantial improvement in the model’s overall performance. In thinking mode, the model simultaneously supports web search, web information extraction, and a code interpreter tool, enabling it to tackle more complex and challenging problems with greater accuracy by leveraging external tools while engaging in slow, deliberative reasoning. This version is based on a snapshot taken on January 23, 2026.",
    "context_window": 256000,
    "max_tokens": 65536,
    "tags": [
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3-next-80b-a3b-instruct",
    "name": "Qwen3 Next 80B A3B Instruct",
    "owned_by": "alibaba",
    "type": "language",
    "description": "A new generation of open-source, non-thinking mode model powered by Qwen3. This version demonstrates superior Chinese text understanding, augmented logical reasoning, and enhanced capabilities in text generation tasks over the previous iteration (Qwen3-235B-A22B-Instruct-2507).",
    "context_window": 131072,
    "max_tokens": 32768,
    "tags": [
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3-next-80b-a3b-thinking",
    "name": "Qwen3 Next 80B A3B Thinking",
    "owned_by": "alibaba",
    "type": "language",
    "description": "A new generation of Qwen3-based open-source thinking mode models. This version offers improved instruction following and streamlined summary responses over the previous iteration (Qwen3-235B-A22B-Thinking-2507).",
    "context_window": 131072,
    "max_tokens": 32768,
    "tags": [
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3-vl-235b-a22b-instruct",
    "name": "Qwen3 VL 235B A22B Instruct",
    "owned_by": "alibaba",
    "type": "language",
    "description": "The Qwen3 series VL models has been comprehensively upgraded in areas such as visual coding and spatial perception. Its visual perception and recognition capabilities have significantly improved, supporting the understanding of ultra-long videos, and its OCR functionality has undergone a major enhancement.",
    "context_window": 131072,
    "max_tokens": 129024,
    "tags": [
      "tool-use",
      "vision",
      "implicit-caching"
    ]
  },
  {
    "id": "alibaba/qwen3-vl-instruct",
    "name": "Qwen3 VL 235B A22B Instruct",
    "owned_by": "alibaba",
    "type": "language",
    "description": "The Qwen3 series VL models has been comprehensively upgraded in areas such as visual coding and spatial perception. Its visual perception and recognition capabilities have significantly improved, supporting the understanding of ultra-long videos, and its OCR functionality has undergone a major enhancement.",
    "context_window": 131072,
    "max_tokens": 129024,
    "tags": [
      "tool-use",
      "vision",
      "implicit-caching"
    ]
  },
  {
    "id": "alibaba/qwen3-vl-thinking",
    "name": "Qwen3 VL 235B A22B Thinking",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3 series VL models feature significantly enhanced multimodal reasoning capabilities, with a particular focus on optimizing the model for STEM and mathematical reasoning. Visual perception and recognition abilities have been comprehensively improved, and OCR capabilities have undergone a major upgrade.",
    "context_window": 131072,
    "max_tokens": 32768,
    "tags": [
      "vision",
      "reasoning",
      "tool-use",
      "file-input"
    ]
  },
  {
    "id": "alibaba/qwen3.5-flash",
    "name": "Qwen 3.5 Flash",
    "owned_by": "alibaba",
    "type": "language",
    "description": "The Qwen3.5 native vision-language Flash models are built on a hybrid architecture that integrates a linear attention mechanism with a sparse mixture-of-experts model, achieving higher inference efficiency. Compared to the 3 series, these models deliver a leap forward in performance for both pure text and multimodal tasks, offering fast response times while balancing inference speed and overall performance.",
    "context_window": 1000000,
    "max_tokens": 64000,
    "tags": [
      "vision",
      "file-input",
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3.5-plus",
    "name": "Qwen 3.5 Plus",
    "owned_by": "alibaba",
    "type": "language",
    "description": "The Qwen3.5 native vision-language series Plus models are built on a hybrid architecture that integrates linear attention mechanisms with sparse mixture-of-experts models, achieving higher inference efficiency. In a variety of task evaluations, the 3.5 series consistently demonstrates performance on par with state-of-the-art leading models. Compared to the 3 series, these models show a leap forward in both pure-text and multimodal capabilities.",
    "context_window": 1000000,
    "max_tokens": 64000,
    "tags": [
      "vision",
      "file-input",
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3.6-27b",
    "name": "Qwen 3.6 27B",
    "owned_by": "alibaba",
    "type": "language",
    "description": "The Qwen3.6 35B-A3B native vision-language model is built on a hybrid architecture that integrates linear attention mechanisms with a sparse mixture-of-experts framework, achieving higher inference efficiency. Compared with the 3.5-35B-A3B, this model demonstrates significantly improved agentic coding capabilities, mathematical and code reasoning abilities, spatial intelligence, as well as object localization and object detection performance.",
    "context_window": 256000,
    "max_tokens": 256000,
    "tags": [
      "reasoning",
      "tool-use",
      "file-input",
      "vision"
    ]
  },
  {
    "id": "alibaba/qwen3.6-plus",
    "name": "Qwen 3.6 Plus",
    "owned_by": "alibaba",
    "type": "language",
    "description": "The Qwen3.6 native vision-language Plus series models demonstrate exceptional performance on par with the current state-of-the-art models, with a significant improvement in overall results compared to the 3.5 series. The models have been markedly enhanced in code-related capabilities such as agentic coding, front-end programming, and Vibe coding, as well as in multi-modal general object recognition, OCR, and object localization.",
    "context_window": 1000000,
    "max_tokens": 64000,
    "tags": [
      "reasoning",
      "tool-use",
      "vision",
      "file-input"
    ]
  },
  {
    "id": "alibaba/qwen3.7-max",
    "name": "Qwen 3.7 Max",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Qwen3.7 is a next‑generation flagship model designed for the agent‑centric era, with its core strengths lying in the breadth and depth of its agent‑level capabilities: it excels at programming, office and productivity tasks, and long‑term autonomous execution.",
    "context_window": 991000,
    "max_tokens": 64000,
    "tags": [
      "implicit-caching",
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "alibaba/qwen3.7-plus",
    "name": "Qwen 3.7 Plus",
    "owned_by": "alibaba",
    "type": "language",
    "description": "Among the Qwen3.7 series, the cost-effective Plus model builds on its robust text capabilities while delivering a comprehensive upgrade to its vision‑language abilities, all while preserving its full‑stack agent‑level intelligence for coding, tool use, and productivity workflows.",
    "context_window": 1000000,
    "max_tokens": 64000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision"
    ]
  },
  {
    "id": "alibaba/wan-v2.5-t2v-preview",
    "name": "Wan v2.5 Text-to-Video Preview",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "alibaba/wan-v2.6-i2v",
    "name": "Wan v2.6 Image-to-Video",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "alibaba/wan-v2.6-i2v-flash",
    "name": "Wan v2.6 Image-to-Video Flash",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "alibaba/wan-v2.6-r2v",
    "name": "Wan v2.6 Reference-to-Video",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "alibaba/wan-v2.6-r2v-flash",
    "name": "Wan v2.6 Reference-to-Video Flash",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "alibaba/wan-v2.6-t2v",
    "name": "Wan v2.6 Text-to-Video",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "alibaba/wan-v2.7-r2v",
    "name": "Wan v2.7 Reference-to-Video",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "alibaba/wan-v2.7-t2v",
    "name": "Wan v2.7 Text-to-Video",
    "owned_by": "alibaba",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "anthropic/claude-3-haiku",
    "name": "Claude 3 Haiku",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude 3 Haiku is Anthropic's fastest, most compact model for near-instant responsiveness. It answers simple queries and requests with speed. Customers will be able to build seamless AI experiences that mimic human interactions. Claude 3 Haiku can process images and return text outputs, and features a 200K context window.",
    "context_window": 200000,
    "max_tokens": 4096,
    "tags": [
      "tool-use",
      "vision",
      "explicit-caching"
    ]
  },
  {
    "id": "anthropic/claude-fable-5",
    "name": "Claude Fable 5",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Fable 5 is a Mythos-class model with robust safeguards. It can handle long-running, complex, and asynchronous tasks where previous models would have needed more frequent check-ins.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "reasoning",
      "tool-use",
      "explicit-caching",
      "file-input",
      "vision"
    ]
  },
  {
    "id": "anthropic/claude-haiku-4.5",
    "name": "Claude Haiku 4.5",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Haiku 4.5 matches Sonnet 4's performance on coding, computer use, and agent tasks at substantially lower cost and faster speeds. It delivers near-frontier performance and Claude’s unique character at a price point that works for scaled sub-agent deployments, free tier products, and intelligence-sensitive applications with budget constraints.",
    "context_window": 200000,
    "max_tokens": 64000,
    "tags": [
      "explicit-caching",
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "anthropic/claude-opus-4",
    "name": "Claude Opus 4",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Opus 4 is Anthropic's most powerful model yet and the state-of-the-art coding model. It delivers sustained performance on long-running tasks that require focused effort and thousands of steps, significantly expanding what AI agents can solve. Claude Opus 4 is ideal for powering frontier agent products and features.",
    "context_window": 200000,
    "max_tokens": 8192,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "explicit-caching"
    ]
  },
  {
    "id": "anthropic/claude-opus-4.1",
    "name": "Claude Opus 4.1",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Opus 4.1 is a drop-in replacement for Opus 4 that delivers superior performance and precision for real-world coding and agentic tasks. Opus 4.1 advances state-of-the-art coding performance to 74.5% on SWE-bench Verified, and handles complex, multi-step problems with more rigor and attention to detail.",
    "context_window": 200000,
    "max_tokens": 32000,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "explicit-caching"
    ]
  },
  {
    "id": "anthropic/claude-opus-4.5",
    "name": "Claude Opus 4.5",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Opus 4.5 is Anthropic’s latest model in the Opus series, meant for demanding reasoning tasks and complex problem solving. This model has improvements in general intelligence and vision compared to previous iterations. In addition, it is suited for difficult coding tasks and agentic workflows, especially those with computer use and tool use, and can effectively handle context usage and external memory files.",
    "context_window": 200000,
    "max_tokens": 64000,
    "tags": [
      "explicit-caching",
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "anthropic/claude-opus-4.6",
    "name": "Claude Opus 4.6",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Opus 4.6 is the world’s best model for coding and professional work, built to power agents that take on whole categories of real-world work. It excels across the entire SDLC, breaking through on hard problems, identifying complex bugs, and demonstrating deeper codebase understanding. It also delivers a step-change in knowledge work, with near-production-ready documents, presentations, and spreadsheets on the first pass.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "tool-use",
      "reasoning",
      "vision",
      "file-input",
      "explicit-caching",
      "web-search"
    ]
  },
  {
    "id": "anthropic/claude-opus-4.7",
    "name": "Claude Opus 4.7",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Opus 4.7 builds on the coding and agentic strengths of Opus 4.6 with stronger performance on complex, multi-step tasks and more reliable agentic execution. It also brings improved performance on knowledge work, from drafting documents to building presentations and analyzing data.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "tool-use",
      "reasoning",
      "vision",
      "file-input",
      "explicit-caching",
      "web-search",
      "fast"
    ]
  },
  {
    "id": "anthropic/claude-opus-4.7-fast",
    "name": "Claude Opus 4.7 (Fast)",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Opus 4.7 builds on the coding and agentic strengths of Opus 4.6 with stronger performance on complex, multi-step tasks and more reliable agentic execution. It also brings improved performance on knowledge work, from drafting documents to building presentations and analyzing data.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "tool-use",
      "reasoning",
      "vision",
      "file-input",
      "explicit-caching",
      "web-search",
      "fast"
    ]
  },
  {
    "id": "anthropic/claude-opus-4.8",
    "name": "Claude Opus 4.8",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Opus 4.8 is a focused upgrade to Opus 4.7 and is Anthropic's best generally available model for coding, agentic tasks, and enterprise workflows. It builds on the strengths of previous Opus models with stronger performance on complex, multi-step coding tasks. Anthropic recommends using it on long-horizon coding and agentic tasks. It is also stronger on professional work, including document drafting, data analysis, and presentations.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "tool-use",
      "reasoning",
      "vision",
      "file-input",
      "explicit-caching",
      "web-search",
      "fast"
    ]
  },
  {
    "id": "anthropic/claude-opus-4.8-fast",
    "name": "Claude Opus 4.8 (Fast)",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Opus 4.8 is a focused upgrade to Opus 4.7 and is Anthropic's best generally available model for coding, agentic tasks, and enterprise workflows. It builds on the strengths of previous Opus models with stronger performance on complex, multi-step coding tasks. Anthropic recommends using it on long-horizon coding and agentic tasks. It is also stronger on professional work, including document drafting, data analysis, and presentations.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "tool-use",
      "reasoning",
      "vision",
      "file-input",
      "explicit-caching",
      "web-search",
      "fast"
    ]
  },
  {
    "id": "anthropic/claude-sonnet-4",
    "name": "Claude Sonnet 4",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Sonnet 4 balances impressive performance for coding with the right speed and cost for high-volume use cases: Coding: Handle everyday development tasks with enhanced performance-power code reviews, bug fixes, API integrations, and feature development with immediate feedback loops.",
    "context_window": 1000000,
    "max_tokens": 8192,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "explicit-caching"
    ]
  },
  {
    "id": "anthropic/claude-sonnet-4.5",
    "name": "Claude Sonnet 4.5",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Sonnet 4.5 is the newest model in the Sonnet series, offering improvements and updates over Sonnet 4.",
    "context_window": 1000000,
    "max_tokens": 64000,
    "tags": [
      "explicit-caching",
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "anthropic/claude-sonnet-4.6",
    "name": "Claude Sonnet 4.6",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Claude Sonnet 4.6 is the most capable Sonnet-class model yet, with frontier performance across coding, agents, and professional work. It excels at iterative development, complex codebase navigation, end-to-end project management with memory, polished document creation, and confident computer use for web QA and workflow automation.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "explicit-caching",
      "web-search"
    ]
  },
  {
    "id": "anthropic/claude-sonnet-5",
    "name": "Claude Sonnet 5",
    "owned_by": "anthropic",
    "type": "language",
    "description": "Sonnet 5 is an upgrade to Sonnet 4.6, with gains across agentic coding and professional work. It builds on the strengths of previous Sonnet models, bringing top-tier intelligence at Sonnet pricing for coding, agents, and everyday professional work at scale.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "reasoning",
      "tool-use",
      "explicit-caching",
      "file-input",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "cohere/embed-v4.0",
    "name": "Embed v4.0",
    "owned_by": "cohere",
    "type": "embedding",
    "description": "A model that allows for text, images, or mixed content to be classified or turned into embeddings.",
    "context_window": 128000,
    "tags": []
  },
  {
    "id": "cohere/rerank-v3.5",
    "name": "Cohere Rerank 3.5",
    "owned_by": "cohere",
    "type": "reranking",
    "description": "A model that allows for re-ranking English Language documents and semi-structured data (JSON).",
    "context_window": 4096,
    "max_tokens": 4096,
    "tags": []
  },
  {
    "id": "cohere/rerank-v4-fast",
    "name": "Cohere Rerank 4 Fast",
    "owned_by": "cohere",
    "type": "reranking",
    "description": "A light version of Rerank 4 Pro, this is a multilingual model that allows for re-ranking English and non-english documents and semi-structured data (JSON). This model is better suited for low latency and high throughput use-cases than its pro variant.",
    "context_window": 32000,
    "max_tokens": 32000,
    "tags": []
  },
  {
    "id": "cohere/rerank-v4-pro",
    "name": "Cohere Rerank 4 Pro",
    "owned_by": "cohere",
    "type": "reranking",
    "description": "A multilingual model that allows for re-ranking English and non-english documents and semi-structured data (JSON). This model is better suited for state-of-the-art quality and complex use-cases than its fast variant.",
    "context_window": 32000,
    "max_tokens": 32000,
    "tags": []
  },
  {
    "id": "deepseek/deepseek-v4-flash",
    "name": "DeepSeek V4 Flash",
    "owned_by": "deepseek",
    "type": "language",
    "description": "DeepSeek-V4 series incorporate several key upgrades in architecture and optimization: (1) a hybrid attention architecture that combines Compressed Sparse Attention (CSA)\nand Heavily Compressed Attention (HCA) to improve long-context efficiency; (2) ManifoldConstrained Hyper-Connections (mHC) that enhance conventional residual connections; (3)\nand the Muon optimizer for faster convergence and greater training stability",
    "context_window": 1000000,
    "max_tokens": 384000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "deepseek/deepseek-v4-pro",
    "name": "DeepSeek V4 Pro",
    "owned_by": "deepseek",
    "type": "language",
    "description": "DeepSeek-V4 series incorporate several key upgrades in architecture and optimization: (1) a hybrid attention architecture that combines Compressed Sparse Attention (CSA)\nand Heavily Compressed Attention (HCA) to improve long-context efficiency; (2) ManifoldConstrained Hyper-Connections (mHC) that enhance conventional residual connections; (3)\nand the Muon optimizer for faster convergence and greater training stability",
    "context_window": 1000000,
    "max_tokens": 384000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "google/gemini-3.1-flash-lite",
    "name": "Gemini 3.1 Flash Lite",
    "owned_by": "google",
    "type": "language",
    "description": "Gemini 3.1 Flash Lite outperforms 2.5 Flash Lite on overall quality and lands close to 2.5 Flash performance across key capability areas. It is a workhorse model for high-volume use cases, with improvements across audio input/ASR, RAG snippet ranking, translation, data extraction, and code completion.",
    "context_window": 1000000,
    "max_tokens": 65000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "google/gemini-3.1-flash-lite-preview",
    "name": "Gemini 3.1 Flash Lite Preview",
    "owned_by": "google",
    "type": "language",
    "description": "Gemini 3.1 Flash Lite Preview outperforms 2.5 Flash Lite on overall quality and lands close to 2.5 Flash performance across key capability areas. It is a workhorse model for high-volume use cases, with improvements across audio input/ASR, RAG snippet ranking, translation, data extraction, and code completion.",
    "context_window": 1000000,
    "max_tokens": 65000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "google/gemini-embedding-001",
    "name": "Gemini Embedding 001",
    "owned_by": "google",
    "type": "embedding",
    "description": "State-of-the-art embedding model with excellent performance across English, multilingual and code tasks.",
    "tags": []
  },
  {
    "id": "google/gemini-embedding-2",
    "name": "Gemini Embedding 2",
    "owned_by": "google",
    "type": "embedding",
    "description": "Google’s first fully multimodal Embedding model that is capable of mapping text, image, video, audio, and PDFs and their interleaved combinations thereof into a single, unified vector space. Built on the Gemini architecture, it supports 100+ languages.",
    "tags": []
  },
  {
    "id": "google/gemma-4-26b-a4b-it",
    "name": "Gemma 4 26B A4B IT",
    "owned_by": "google",
    "type": "language",
    "description": "Gemma is a family of open models built by Google DeepMind. Gemma 4 models are multimodal, handling text and image input (with audio supported on small models) and generating text output. This release includes open-weights models in both pre-trained and instruction-tuned variants. Gemma 4 features a context window of up to 256K tokens and maintains multilingual support in over 140 languages.",
    "context_window": 262144,
    "max_tokens": 131072,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "implicit-caching"
    ]
  },
  {
    "id": "google/gemma-4-31b-it",
    "name": "Gemma 4 31B IT",
    "owned_by": "google",
    "type": "language",
    "description": "Gemma 4 31B is engineered to tackle the most demanding enterprise workloads and complex reasoning tasks. With an expansive 256K-token context window, the 31B model can effortlessly ingest entire codebases, and massive sets of images in a single prompt.",
    "context_window": 262144,
    "max_tokens": 131072,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "google/imagen-4.0-fast-generate-001",
    "name": "Imagen 4 Fast",
    "owned_by": "google",
    "type": "image",
    "description": "Imagen 4 Fast is Google’s speed-optimized variant of the Imagen 4 text-to-image model, designed for rapid, high-volume image generation. It’s ideal for workflows like quick drafts, mockups, and iterative creative exploration. Despite emphasizing speed, it still benefits from the broader Imagen 4 family’s improvements in clarity, text rendering, and stylistic flexibility, and supports high-resolution outputs up to 2K.",
    "context_window": 480,
    "tags": [
      "image-generation"
    ]
  },
  {
    "id": "google/imagen-4.0-generate-001",
    "name": "Imagen 4",
    "owned_by": "google",
    "type": "image",
    "description": "Imagen 4: Google's flagship text-to-image model that serves as the go-to choice for a wide variety of high-quality image generation tasks, featuring significant improvements in text rendering over previous models. It now supports up to 2K resolution generation for creating detailed and crisp visuals, making it suitable for everything from marketing assets to artistic compositions.",
    "context_window": 480,
    "tags": [
      "image-generation"
    ]
  },
  {
    "id": "google/imagen-4.0-ultra-generate-001",
    "name": "Imagen 4 Ultra",
    "owned_by": "google",
    "type": "image",
    "description": "Imagen 4 Ultra: Highest quality image generation model for detailed and photorealistic outputs.",
    "context_window": 480,
    "tags": [
      "image-generation"
    ]
  },
  {
    "id": "google/veo-3.0-fast-generate-001",
    "name": "Veo 3.0 Fast Generate",
    "owned_by": "google",
    "type": "video",
    "description": "Veo 3 Fast is a quicker and more cost effective version of Veo 3, allowing developers to create videos with sound while maintaining high quality and optimizing for speed and business use cases. Veo 3 Fast offers both text-to-video and image-to-video modalities.",
    "tags": []
  },
  {
    "id": "google/veo-3.0-generate-001",
    "name": "Veo 3.0",
    "owned_by": "google",
    "type": "video",
    "description": "Veo 3 is designed to handle a range of video generation tasks, from cinematic narratives to dynamic character animations. With Veo 3, you can create more immersive experiences by not only generating stunning visuals, but also audio like dialogue and sound effects.",
    "tags": []
  },
  {
    "id": "google/veo-3.1-fast-generate-001",
    "name": "Veo 3.1 Fast Generate",
    "owned_by": "google",
    "type": "video",
    "description": "Veo 3.1 Fast is a specialized, high-speed variant of Google DeepMind’s Veo 3.1 text-to-video model, optimized for rapid generation of 8-second, high-fidelity videos. It is designed to create cinematic, 1080p, or 720p content with improved prompt adherence and native audio, making it ideal for creating quick, high-quality video clips, social media content, and ad creatives.",
    "tags": []
  },
  {
    "id": "google/veo-3.1-generate-001",
    "name": "Veo 3.1",
    "owned_by": "google",
    "type": "video",
    "description": "Veo 3.1 is Google's state-of-the-art model for generating high-fidelity, 8-second 720p, 1080p or 4k videos featuring stunning realism and natively generated audio.",
    "tags": []
  },
  {
    "id": "meta/llama-3.1-70b",
    "name": "Llama 3.1 70B Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "An update to Meta Llama 3 70B Instruct that includes an expanded 128K context length, multilinguality and improved reasoning capabilities.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "tool-use"
    ]
  },
  {
    "id": "meta/llama-3.1-8b",
    "name": "Llama 3.1 8B Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "An update to Meta Llama 3 8B Instruct that includes an expanded 128K context length, multilinguality and improved reasoning capabilities.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "meta/llama-3.2-11b",
    "name": "Llama 3.2 11B Vision Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "Instruction-tuned image reasoning generative model (text + images in / text out) optimized for visual recognition, image reasoning, captioning and answering general questions about the image.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "meta/llama-3.2-1b",
    "name": "Llama 3.2 1B Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "Text-only model, supporting on-device use cases such as multilingual local knowledge retrieval, summarization, and rewriting.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": []
  },
  {
    "id": "meta/llama-3.2-3b",
    "name": "Llama 3.2 3B Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "Text-only model, fine-tuned for supporting on-device use cases such as multilingual local knowledge retrieval, summarization, and rewriting.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": []
  },
  {
    "id": "meta/llama-3.2-90b",
    "name": "Llama 3.2 90B Vision Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "Instruction-tuned image reasoning generative model (text + images in / text out) optimized for visual recognition, image reasoning, captioning and answering general questions about the image.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "meta/llama-3.3-70b",
    "name": "Llama 3.3 70B Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "Where performance meets efficiency. This model supports high-performance conversational AI designed for content creation, enterprise applications, and research, offering advanced language understanding capabilities, including text summarization, classification, sentiment analysis, and code generation.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "tool-use"
    ]
  },
  {
    "id": "meta/llama-4-maverick",
    "name": "Llama 4 Maverick 17B Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "As a general purpose LLM, Llama 4 Maverick contains 17 billion active parameters, 128 experts, and 400 billion total parameters, offering high quality at a lower price compared to Llama 3.3 70B.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "meta/llama-4-scout",
    "name": "Llama 4 Scout 17B Instruct",
    "owned_by": "meta",
    "type": "language",
    "description": "Llama 4 Scout is the best multimodal model in the world in its class and is more powerful than our Llama 3 models, while fitting in a single H100 GPU. Additionally, Llama 4 Scout supports an industry-leading context window of up to 10M tokens.",
    "context_window": 128000,
    "max_tokens": 8192,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "meta/muse-spark-1.1",
    "name": "Muse Spark 1.1",
    "owned_by": "meta",
    "type": "language",
    "description": "Muse Spark 1.1 is strongest at agentic performance, tool use, and computer use. It does well on long-running tasks with 1M token context window, can delegate execution to sub-agents running in parallel, and is trained to use computer interfaces on desktop, mobile, or browser.",
    "context_window": 1048576,
    "max_tokens": 1048576,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision"
    ]
  },
  {
    "id": "mistral/codestral-embed",
    "name": "Codestral Embed",
    "owned_by": "mistral",
    "type": "embedding",
    "description": "Code embedding model that can embed code databases and repositories to power coding assistants.",
    "tags": []
  },
  {
    "id": "mistral/mistral-embed",
    "name": "Mistral Embed",
    "owned_by": "mistral",
    "type": "embedding",
    "description": "General-purpose text embedding model for semantic search, similarity, clustering, and RAG workflows.",
    "tags": []
  },
  {
    "id": "mistral/mistral-medium",
    "name": "Mistral Medium 3.1",
    "owned_by": "mistral",
    "type": "language",
    "description": "Mistral Medium 3 delivers frontier performance while being an order of magnitude less expensive. For instance, the model performs at or above 90% of Claude Sonnet 3.7 on benchmarks across the board at a significantly lower cost.",
    "context_window": 128000,
    "max_tokens": 64000,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "mistral/mistral-medium-3.5",
    "name": "Mistral Medium Latest",
    "owned_by": "mistral",
    "type": "language",
    "description": "Mistral's frontier-class multimodal model optimized for agentic and coding use cases.",
    "context_window": 256000,
    "max_tokens": 256000,
    "tags": [
      "reasoning",
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "mistral/mistral-small",
    "name": "Mistral Small",
    "owned_by": "mistral",
    "type": "language",
    "description": "Mistral Small is the ideal choice for simple tasks that one can do in bulk - like Classification, Customer Support, or Text Generation. It offers excellent performance at an affordable price point.",
    "context_window": 32000,
    "max_tokens": 4000,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "mistral/pixtral-12b",
    "name": "Pixtral 12B 2409",
    "owned_by": "mistral",
    "type": "language",
    "description": "A 12B model with image understanding capabilities in addition to text.",
    "context_window": 128000,
    "max_tokens": 4000,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "openai/gpt-3.5-turbo",
    "name": "GPT-3.5 Turbo",
    "owned_by": "openai",
    "type": "language",
    "description": "OpenAI's most capable and cost effective model in the GPT-3.5 family optimized for chat purposes, but also works well for traditional completions tasks.",
    "context_window": 16385,
    "max_tokens": 4096,
    "tags": [
      "tool-use"
    ]
  },
  {
    "id": "openai/gpt-4-turbo",
    "name": "GPT-4 Turbo",
    "owned_by": "openai",
    "type": "language",
    "description": "gpt-4-turbo from OpenAI has broad general knowledge and domain expertise allowing it to follow complex instructions in natural language and solve difficult problems accurately. It has a knowledge cutoff of April 2023 and a 128,000 token context window.",
    "context_window": 128000,
    "max_tokens": 4096,
    "tags": [
      "tool-use",
      "vision"
    ]
  },
  {
    "id": "openai/gpt-4.1",
    "name": "GPT-4.1",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT 4.1 is OpenAI's flagship model for complex tasks. It is well suited for problem solving across domains.",
    "context_window": 1047576,
    "max_tokens": 32768,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-4.1-mini",
    "name": "GPT-4.1 mini",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT 4.1 mini provides a balance between intelligence, speed, and cost that makes it an attractive model for many use cases.",
    "context_window": 1047576,
    "max_tokens": 32768,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-4.1-nano",
    "name": "GPT-4.1 nano",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-4.1 nano is the fastest, most cost-effective GPT 4.1 model.",
    "context_window": 1047576,
    "max_tokens": 32768,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-4o",
    "name": "GPT-4o",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-4o from OpenAI has broad general knowledge and domain expertise allowing it to follow complex instructions in natural language and solve difficult problems accurately. It matches GPT-4 Turbo performance with a faster and cheaper API.",
    "context_window": 128000,
    "max_tokens": 16384,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-4o-mini",
    "name": "GPT-4o mini",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-4o mini from OpenAI is their most advanced and cost-efficient small model. It is multi-modal (accepting text or image inputs and outputting text) and has higher intelligence than gpt-3.5-turbo but is just as fast.",
    "context_window": 128000,
    "max_tokens": 16384,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-4o-mini-search-preview",
    "name": "GPT 4o Mini Search Preview",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-4o mini Search Preview is a specialized model trained to understand and execute web search queries with the Chat Completions API. In addition to token fees, web search queries have a fee per tool call.",
    "context_window": 128000,
    "max_tokens": 16384,
    "tags": [
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-4o-mini-transcribe",
    "name": "GPT-4o mini Transcribe",
    "owned_by": "openai",
    "type": "transcription",
    "description": "GPT-4o mini Transcribe is a speech-to-text model that uses GPT-4o mini to transcribe audio. It offers improvements to word error rate and better language recognition and accuracy compared to original Whisper models. Use it for more accurate transcripts.",
    "tags": []
  },
  {
    "id": "openai/gpt-4o-transcribe",
    "name": "GPT-4o Transcribe",
    "owned_by": "openai",
    "type": "transcription",
    "description": "GPT-4o Transcribe is a speech-to-text model that uses GPT-4o to transcribe audio. It offers improvements to word error rate and better language recognition and accuracy compared to original Whisper models. Use it for more accurate transcripts.",
    "tags": []
  },
  {
    "id": "openai/gpt-5",
    "name": "GPT-5",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5 is OpenAI's flagship language model that excels at complex reasoning, broad real-world knowledge, code-intensive, and multi-step agentic tasks.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5-chat",
    "name": "GPT 5 Chat",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5 Chat points to the GPT-5 snapshot currently used in ChatGPT.",
    "context_window": 128000,
    "max_tokens": 16384,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5-codex",
    "name": "GPT-5-Codex",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5-Codex is a version of GPT-5 optimized for agentic coding tasks in Codex or similar environments.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5-mini",
    "name": "GPT-5 mini",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5 mini is a cost optimized model that excels at reasoning/chat tasks. It offers an optimal balance between speed, cost, and capability.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5-nano",
    "name": "GPT-5 nano",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5 nano is a high throughput model that excels at simple instruction or classification tasks.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5-pro",
    "name": "GPT-5 pro",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5 pro uses more compute to think harder and provide consistently better answers. Since GPT-5 pro is designed to tackle tough problems, some requests may take several minutes to finish.",
    "context_window": 400000,
    "max_tokens": 272000,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.1-codex",
    "name": "GPT-5.1-Codex",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.1-Codex is a version of GPT-5.1 optimized for agentic coding tasks in Codex or similar environments.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.1-codex-max",
    "name": "GPT 5.1 Codex Max",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT‑5.1-Codex-Max is purpose-built for agentic coding.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.1-codex-mini",
    "name": "GPT 5.1 Codex Mini",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.1 Codex mini is a smaller, faster, and cheaper version of GPT-5.1 Codex.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.1-instant",
    "name": "GPT-5.1 Instant",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.1 Instant (or GPT-5.1 chat) is a warmer and more conversational version of GPT-5-chat, with improved instruction following and adaptive reasoning for deciding when to think before responding.",
    "context_window": 128000,
    "max_tokens": 16384,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.1-thinking",
    "name": "GPT 5.1 Thinking",
    "owned_by": "openai",
    "type": "language",
    "description": "An upgraded version of GPT-5 that adapts thinking time more precisely to the question to spend more time on complex questions and respond more quickly to simpler tasks.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.2",
    "name": "GPT 5.2",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.2 is OpenAI's best general-purpose model, part of the GPT-5 flagship model family. It's their most intelligent model yet for both general and agentic tasks.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.2-chat",
    "name": "GPT 5.2 Chat",
    "owned_by": "openai",
    "type": "language",
    "description": "The model powering ChatGPT is gpt-5.2-chat-latest: this is OpenAI's best general-purpose model, part of the GPT-5 flagship model family.",
    "context_window": 128000,
    "max_tokens": 16384,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.2-codex",
    "name": "GPT 5.2 Codex",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT‑5.2-Codex is a version of GPT‑5.2⁠ further optimized for agentic coding in Codex, including improvements on long-horizon work through context compaction, stronger performance on large code changes like refactors and migrations, improved performance in Windows environments, and significantly stronger cybersecurity capabilities.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.2-pro",
    "name": "GPT 5.2 ",
    "owned_by": "openai",
    "type": "language",
    "description": "Version of GPT-5.2 that produces smarter and more precise responses.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "tool-use",
      "vision",
      "reasoning",
      "file-input",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.3-chat",
    "name": "GPT-5.3 Chat",
    "owned_by": "openai",
    "type": "language",
    "description": "The model powering ChatGPT is gpt-5.3-chat-latest: this is OpenAI's best general-purpose model, part of the GPT-5 flagship model family.",
    "context_window": 128000,
    "max_tokens": 16384,
    "tags": [
      "file-input",
      "implicit-caching",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.3-codex",
    "name": "GPT 5.3 Codex",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.3-Codex advances both the frontier coding performance of GPT‑5.2-Codex and the reasoning and professional knowledge capabilities of GPT‑5.2, together in one model, which is also 25% faster. This enables it to take on long-running tasks that involve research, tool use, and complex execution.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.4",
    "name": "GPT 5.4",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.4 is OpenAI's best general-purpose model, part of the GPT-5 flagship model family. It's their most intelligent model yet for both general and agentic tasks.",
    "context_window": 1050000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search",
      "websocket-realtime"
    ]
  },
  {
    "id": "openai/gpt-5.4-mini",
    "name": "GPT 5.4 Mini",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.4 Mini brings the strengths of GPT-5.4 to a faster, more efficient model designed for high-volume workloads.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.4-nano",
    "name": "GPT 5.4 Nano",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.4 Nano is designed for tasks where speed and cost matter most like classification, data extraction, ranking, and sub-agents.",
    "context_window": 400000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.4-pro",
    "name": "GPT 5.4 Pro",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.4 Pro uses more compute to think harder and provide consistently better answers. It's designed to tackle tough problems.",
    "context_window": 1050000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/gpt-5.5",
    "name": "GPT 5.5",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT‑5.5 understands what you’re trying to do faster and can carry more of the work itself. It excels at writing and debugging code, researching online, analyzing data, creating documents and spreadsheets, operating software, and moving across tools until a task is finished. Instead of carefully managing every step, you can give GPT‑5.5 a messy, multi-part task and trust it to plan, use tools, check its work, navigate through ambiguity, and keep going.",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search",
      "websocket-realtime"
    ]
  },
  {
    "id": "openai/gpt-5.5-pro",
    "name": "GPT 5.5 Pro",
    "owned_by": "openai",
    "type": "language",
    "description": "",
    "context_window": 1000000,
    "max_tokens": 128000,
    "tags": [
      "reasoning",
      "tool-use",
      "file-input",
      "web-search",
      "vision"
    ]
  },
  {
    "id": "openai/gpt-5.6-luna",
    "name": "GPT 5.6 Luna",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.6 Luna is a fast, affordable GPT-5.6 model that brings strong capability at the lowest cost in the series.",
    "context_window": 1050000,
    "max_tokens": 128000,
    "tags": [
      "reasoning",
      "file-input",
      "tool-use",
      "vision",
      "implicit-caching",
      "web-search",
      "websocket-realtime"
    ]
  },
  {
    "id": "openai/gpt-5.6-sol",
    "name": "GPT 5.6 Sol",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.6 Sol is the flagship of OpenAI's GPT-5.6 series, its most capable model for long-horizon agentic work across coding, biology, and cybersecurity.",
    "context_window": 1050000,
    "max_tokens": 128000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision",
      "web-search",
      "websocket-realtime"
    ]
  },
  {
    "id": "openai/gpt-5.6-terra",
    "name": "GPT 5.6 Terra",
    "owned_by": "openai",
    "type": "language",
    "description": "GPT-5.6 Terra is a balanced GPT-5.6 model for everyday work, with performance comparable to the previous generation at half the cost.",
    "context_window": 1050000,
    "max_tokens": 128000,
    "tags": [
      "reasoning",
      "web-search",
      "file-input",
      "tool-use",
      "vision",
      "implicit-caching",
      "websocket-realtime"
    ]
  },
  {
    "id": "openai/gpt-image-1",
    "name": "GPT Image 1",
    "owned_by": "openai",
    "type": "image",
    "description": "GPT Image 1 is OpenAI's new state-of-the-art image generation model. It is a natively multimodal language model that accepts both text and image inputs, and produces image outputs.",
    "tags": [
      "image-generation",
      "implicit-caching"
    ]
  },
  {
    "id": "openai/gpt-image-1-mini",
    "name": "GPT Image 1 Mini",
    "owned_by": "openai",
    "type": "image",
    "description": "A cost-efficient version of GPT Image 1. It is a natively multimodal language model that accepts both text and image inputs, and produces image outputs.",
    "tags": [
      "image-generation",
      "implicit-caching"
    ]
  },
  {
    "id": "openai/gpt-image-1.5",
    "name": "GPT Image 1.5",
    "owned_by": "openai",
    "type": "image",
    "description": "GPT Image 1.5 is OpenAI's latest image generation model, with better instruction following and adherence to prompts.",
    "tags": [
      "image-generation",
      "implicit-caching"
    ]
  },
  {
    "id": "openai/gpt-image-2",
    "name": "GPT Image 2",
    "owned_by": "openai",
    "type": "image",
    "description": "GPT Image 2 is OpenAI's state-of-the-art image generation model for fast, high-quality image generation and editing. It supports flexible image sizes and high-fidelity image inputs.",
    "tags": [
      "image-generation",
      "implicit-caching"
    ]
  },
  {
    "id": "openai/gpt-oss-120b",
    "name": "GPT OSS 120B",
    "owned_by": "openai",
    "type": "language",
    "description": "Extremely capable general-purpose LLM with strong, controllable reasoning capabilities",
    "context_window": 131072,
    "max_tokens": 131072,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "openai/gpt-oss-20b",
    "name": "GPT OSS 20B",
    "owned_by": "openai",
    "type": "language",
    "description": "A compact, open-weight language model optimized for low-latency and resource-constrained environments, including local and edge deployments.",
    "context_window": 131072,
    "max_tokens": 8192,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "openai/gpt-oss-safeguard-20b",
    "name": "GPT OSS Safeguard 20B",
    "owned_by": "openai",
    "type": "language",
    "description": "OpenAI's first open weight reasoning model specifically trained for safety classification tasks. Fine-tuned from GPT-OSS, this model helps classify text content based on customizable policies, enabling bring-your-own-policy Trust & Safety AI where your own taxonomy, definitions, and thresholds guide classification decisions.",
    "context_window": 131072,
    "max_tokens": 65536,
    "tags": [
      "implicit-caching",
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "openai/gpt-realtime-1.5",
    "name": "GPT-Realtime-1.5",
    "owned_by": "openai",
    "type": "realtime",
    "description": "GPT-Realtime-1.5 is our flagship audio model for voice agents and customer support.",
    "tags": []
  },
  {
    "id": "openai/gpt-realtime-2",
    "name": "gpt-realtime-2",
    "owned_by": "openai",
    "type": "realtime",
    "description": "GPT Realtime 2 is our most capable realtime voice model. It supports speech-to-speech interactions with configurable reasoning effort, stronger instruction following, and more reliable tool use for complex voice-agent workflows.",
    "tags": [
      "websocket-realtime"
    ]
  },
  {
    "id": "openai/gpt-realtime-2.1",
    "name": "gpt-realtime-2.1",
    "owned_by": "openai",
    "type": "realtime",
    "description": "GPT-Realtime-2.1 updates GPT-Realtime-2 with improved alphanumeric recognition, silence and noise handling, and interruption behavior. It supports speech-to-speech interactions with configurable reasoning effort, instruction following, and tool use for complex voice-agent workflows.",
    "context_window": 128000,
    "max_tokens": 32000,
    "tags": []
  },
  {
    "id": "openai/gpt-realtime-mini",
    "name": "GPT-Realtime mini",
    "owned_by": "openai",
    "type": "realtime",
    "description": "GPT-Realtime mini is capable of responding to audio and text inputs in realtime over WebRTC, WebSocket, or SIP connections.",
    "tags": []
  },
  {
    "id": "openai/o1",
    "name": "o1",
    "owned_by": "openai",
    "type": "language",
    "description": "o1 is OpenAI's flagship reasoning model, designed for complex problems that require deep thinking. It provides strong reasoning capabilities with improved accuracy for complex multi-step tasks.",
    "context_window": 200000,
    "max_tokens": 100000,
    "tags": [
      "file-input",
      "reasoning",
      "tool-use",
      "vision",
      "implicit-caching"
    ]
  },
  {
    "id": "openai/o3",
    "name": "o3",
    "owned_by": "openai",
    "type": "language",
    "description": "OpenAI's o3 is their most powerful reasoning model, setting new state-of-the-art benchmarks in coding, math, science, and visual perception. It excels at complex queries requiring multi-faceted analysis, with particular strength in analyzing images, charts, and graphics.",
    "context_window": 200000,
    "max_tokens": 100000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/o3-deep-research",
    "name": "o3-deep-research",
    "owned_by": "openai",
    "type": "language",
    "description": "o3-deep-research is OpenAI's most advanced model for deep research, designed to tackle complex, multi-step research tasks. It can search and synthesize information from across the internet as well as from your own data—brought in through MCP connectors.",
    "context_window": 200000,
    "max_tokens": 100000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/o3-mini",
    "name": "o3-mini",
    "owned_by": "openai",
    "type": "language",
    "description": "o3-mini is OpenAI's most recent small reasoning model, providing high intelligence at the same cost and latency targets of o1-mini.",
    "context_window": 200000,
    "max_tokens": 100000,
    "tags": [
      "implicit-caching",
      "reasoning",
      "tool-use"
    ]
  },
  {
    "id": "openai/o3-pro",
    "name": "o3 Pro",
    "owned_by": "openai",
    "type": "language",
    "description": "The o-series of models are trained with reinforcement learning to think before they answer and perform complex reasoning. The o3-pro model uses more compute to think harder and provide consistently better answers.",
    "context_window": 200000,
    "max_tokens": 100000,
    "tags": [
      "reasoning",
      "vision",
      "file-input",
      "tool-use",
      "web-search"
    ]
  },
  {
    "id": "openai/o4-mini",
    "name": "o4-mini",
    "owned_by": "openai",
    "type": "language",
    "description": "OpenAI's o4-mini delivers fast, cost-efficient reasoning with exceptional performance for its size, particularly excelling in math (best-performing on AIME benchmarks), coding, and visual tasks.",
    "context_window": 200000,
    "max_tokens": 100000,
    "tags": [
      "file-input",
      "implicit-caching",
      "reasoning",
      "tool-use",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "openai/text-embedding-3-large",
    "name": "text-embedding-3-large",
    "owned_by": "openai",
    "type": "embedding",
    "description": "OpenAI's most capable embedding model for both english and non-english tasks.",
    "tags": []
  },
  {
    "id": "openai/text-embedding-3-small",
    "name": "text-embedding-3-small",
    "owned_by": "openai",
    "type": "embedding",
    "description": "OpenAI's improved, more performant version of their ada embedding model.",
    "tags": []
  },
  {
    "id": "openai/text-embedding-ada-002",
    "name": "text-embedding-ada-002",
    "owned_by": "openai",
    "type": "embedding",
    "description": "OpenAI's legacy text embedding model.",
    "tags": []
  },
  {
    "id": "openai/tts-1",
    "name": "TTS-1",
    "owned_by": "openai",
    "type": "speech",
    "description": "TTS is a model that converts text to natural sounding spoken text.",
    "tags": []
  },
  {
    "id": "openai/tts-1-hd",
    "name": "TTS-1 HD",
    "owned_by": "openai",
    "type": "speech",
    "description": "TTS is a model that converts text to natural sounding spoken text. The tts-1-hd model is optimized for high quality text-to-speech use cases.",
    "tags": []
  },
  {
    "id": "openai/whisper-1",
    "name": "Whisper",
    "owned_by": "openai",
    "type": "transcription",
    "description": "Whisper is a general-purpose speech recognition model, trained on a large dataset of diverse audio. You can also use it as a multitask model to perform multilingual speech recognition as well as speech translation and language identification.",
    "tags": []
  },
  {
    "id": "perplexity/sonar",
    "name": "Sonar",
    "owned_by": "perplexity",
    "type": "language",
    "description": "Perplexity's lightweight offering with search grounding, quicker and cheaper than Sonar Pro.",
    "context_window": 127000,
    "max_tokens": 8000,
    "tags": [
      "vision",
      "web-search"
    ]
  },
  {
    "id": "perplexity/sonar-pro",
    "name": "Sonar Pro",
    "owned_by": "perplexity",
    "type": "language",
    "description": "Perplexity's premier offering with search grounding, supporting advanced queries and follow-ups.",
    "context_window": 200000,
    "max_tokens": 8000,
    "tags": [
      "vision",
      "web-search"
    ]
  },
  {
    "id": "perplexity/sonar-reasoning-pro",
    "name": "Sonar Reasoning Pro",
    "owned_by": "perplexity",
    "type": "language",
    "description": "A premium reasoning-focused model that outputs Chain of Thought (CoT) in responses, providing comprehensive explanations with enhanced search capabilities and multiple search queries per request.",
    "context_window": 127000,
    "max_tokens": 8000,
    "tags": [
      "reasoning",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.1-fast-non-reasoning",
    "name": "Grok 4.1 Fast Non-Reasoning",
    "owned_by": "xai",
    "type": "language",
    "description": "",
    "context_window": 1000000,
    "max_tokens": 1000000,
    "tags": [
      "tool-use",
      "file-input",
      "vision",
      "implicit-caching"
    ]
  },
  {
    "id": "xai/grok-4.1-fast-reasoning",
    "name": "Grok 4.1 Fast Reasoning",
    "owned_by": "xai",
    "type": "language",
    "description": "",
    "context_window": 1000000,
    "max_tokens": 1000000,
    "tags": [
      "reasoning",
      "file-input",
      "vision",
      "tool-use",
      "implicit-caching"
    ]
  },
  {
    "id": "xai/grok-4.20-multi-agent",
    "name": "Grok 4.20 Multi-Agent",
    "owned_by": "xai",
    "type": "language",
    "description": "Multiple agents collaborate in parallel to perform deep research tasks.",
    "context_window": 2000000,
    "max_tokens": 2000000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "vision",
      "file-input",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.20-multi-agent-beta",
    "name": "Grok 4.20 Multi Agent Beta",
    "owned_by": "xai",
    "type": "language",
    "description": "Multiple agents collaborate in parallel to perform deep research tasks.",
    "context_window": 2000000,
    "max_tokens": 2000000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "vision",
      "file-input",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.20-non-reasoning",
    "name": "Grok 4.20 Non-Reasoning",
    "owned_by": "xai",
    "type": "language",
    "description": "Grok 4.20 Beta is the newest flagship model from xAI with industry-leading speed and agentic tool calling capabilities. It combines the lowest hallucination rate on the market with strict prompt adherence, delivering consistently precise and truthful responses.",
    "context_window": 2000000,
    "max_tokens": 2000000,
    "tags": [
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.20-non-reasoning-beta",
    "name": "Grok 4.20 Beta Non-Reasoning",
    "owned_by": "xai",
    "type": "language",
    "description": "Grok 4.20 Beta is the newest flagship model from xAI with industry-leading speed and agentic tool calling capabilities. It combines the lowest hallucination rate on the market with strict prompt adherance, delivering consistently precise and truthful responses.",
    "context_window": 2000000,
    "max_tokens": 2000000,
    "tags": [
      "tool-use",
      "implicit-caching",
      "vision",
      "file-input",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.20-reasoning",
    "name": "Grok 4.20 Reasoning",
    "owned_by": "xai",
    "type": "language",
    "description": "Grok 4.20 Beta is the newest flagship model from xAI with industry-leading speed and agentic tool calling capabilities. It combines the lowest hallucination rate on the market with strict prompt adherence, delivering consistently precise and truthful responses.",
    "context_window": 2000000,
    "max_tokens": 2000000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "vision",
      "file-input",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.20-reasoning-beta",
    "name": "Grok 4.20 Beta Reasoning",
    "owned_by": "xai",
    "type": "language",
    "description": "Grok 4.20 Beta is the newest flagship model from xAI with industry-leading speed and agentic tool calling capabilities. It combines the lowest hallucination rate on the market with strict prompt adherance, delivering consistently precise and truthful responses.",
    "context_window": 2000000,
    "max_tokens": 2000000,
    "tags": [
      "reasoning",
      "tool-use",
      "vision",
      "file-input",
      "implicit-caching",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.3",
    "name": "Grok 4.3",
    "owned_by": "xai",
    "type": "language",
    "description": "Grok 4.3 is a new model matching the scale of Grok 4.20 with an improved architecture and a December 2025 knowledge cutoff.",
    "context_window": 1000000,
    "max_tokens": 1000000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-4.5",
    "name": "Grok 4.5",
    "owned_by": "xai",
    "type": "language",
    "description": "SpaceXAI's smartest model with frontier performance on coding, knowledge work, and STEM.",
    "context_window": 500000,
    "max_tokens": 500000,
    "tags": [
      "reasoning",
      "tool-use",
      "implicit-caching",
      "file-input",
      "vision",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-build-0.1",
    "name": "Grok Build 0.1",
    "owned_by": "xai",
    "type": "language",
    "description": "xAI's fast coding model trained specifically for agentic coding.",
    "context_window": 256000,
    "max_tokens": 256000,
    "tags": [
      "reasoning",
      "implicit-caching",
      "vision",
      "tool-use",
      "web-search"
    ]
  },
  {
    "id": "xai/grok-imagine-image",
    "name": "Grok Imagine Image",
    "owned_by": "xai",
    "type": "image",
    "description": "Generate high-quality images from text prompts with xAI's imagine API.",
    "tags": [
      "image-generation"
    ]
  },
  {
    "id": "xai/grok-imagine-video",
    "name": "Grok Imagine",
    "owned_by": "xai",
    "type": "video",
    "description": "State-of-the-art video generation across quality, cost, and latency. Grok Imagine is x.AI's most powerful video-audio generative model yet. Bring an image to life, start from a simple text prompt, or even refine a complex cinematic sequence.",
    "tags": []
  },
  {
    "id": "xai/grok-imagine-video-1.5",
    "name": "Grok Imagine Video 1.5",
    "owned_by": "xai",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "xai/grok-imagine-video-1.5-preview",
    "name": "Grok Imagine Video 1.5 Preview",
    "owned_by": "xai",
    "type": "video",
    "description": "",
    "tags": []
  },
  {
    "id": "xai/grok-stt",
    "name": "Grok STT",
    "owned_by": "xai",
    "type": "transcription",
    "description": "Transcribe audio to text in 25 languages with batch and streaming modes.",
    "tags": []
  },
  {
    "id": "xai/grok-tts",
    "name": "Grok TTS",
    "owned_by": "xai",
    "type": "speech",
    "description": "Generate speech with 5 expressive voices, speech tags, and telephony codecs.",
    "tags": []
  },
  {
    "id": "xai/grok-voice-think-fast-1.0",
    "name": "Grok Voice Think Fast 1.0",
    "owned_by": "xai",
    "type": "realtime",
    "description": "Build real-time voice applications powered by Grok. Stream audio and text bidirectionally via WebSocket for voice assistants, phone agents, and interactive voice systems.",
    "tags": []
  }
];

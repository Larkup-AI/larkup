from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .config import Settings
from .pipeline import run_pipeline
from .store import Store


logger = logging.getLogger(__name__)


class JobService:
    def __init__(self, settings: Settings, store: Store):
        self.settings = settings
        self.store = store
        self.executor = ThreadPoolExecutor(
            max_workers=settings.workers, thread_name_prefix="video-job"
        )

    def submit(self, job_id: str) -> None:
        self.executor.submit(self.run, job_id)

    def run(self, job_id: str) -> None:
        try:
            job = self.store.get_job_for_worker(job_id)
            upload = self.store.get_upload(job["principal_id"], job["upload_id"])
            result, actual_minutes = run_pipeline(
                Path(upload["path"]),
                job["request"]["brief"],
                self.settings.model_dir,
                self.settings.device,
                lambda stage, percent, message: self.store.update_job(
                    job_id, stage, percent, message
                ),
                self.settings.disable_heavy_operators,
                self.settings.semantic_vision_enabled,
                self.settings.semantic_vision_model,
            )
            result["jobId"] = job_id
            self.store.finish_job(job_id, result, actual_minutes)
            if job["request"]["brief"].get("retainSourceHours", 0) == 0:
                Path(upload["path"]).unlink(missing_ok=True)
        except Exception as error:
            logger.exception("Video indexing job %s failed", job_id)
            self.store.fail_job(job_id, str(error))

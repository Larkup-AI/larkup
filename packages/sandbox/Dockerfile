FROM python:3.12-slim

LABEL maintainer="larkup" \
      description="Larkup sandbox for data analysis code execution"

# Install data analysis libraries
RUN pip install --no-cache-dir \
    pandas==2.2.3 \
    numpy==2.2.6 \
    matplotlib==3.10.3 \
    openpyxl==3.1.5 \
    scipy==1.15.3 \
    scikit-learn==1.7.0 \
    seaborn==0.13.2 \
    xlrd==2.0.1 \
    pypdf==5.1.0 \
    python-docx==1.1.2 \
    python-pptx==1.0.2 \
    Pillow==11.1.0

# Matplotlib non-interactive backend (no display needed)
ENV MPLBACKEND=Agg

WORKDIR /sandbox

# Non-root user for security
RUN useradd -m -s /bin/bash sandboxuser
USER sandboxuser

ENTRYPOINT ["python3", "-c"]

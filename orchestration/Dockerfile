FROM python:3.12-slim

# One image for the webserver and the daemon; versions pinned in requirements.txt.
ENV DAGSTER_HOME=/opt/dagster/home \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /opt/dagster/app
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY dagster.yaml ${DAGSTER_HOME}/dagster.yaml
COPY workspace.yaml .
COPY webatlas_orchestration ./webatlas_orchestration

RUN useradd --system --uid 10001 --home-dir /opt/dagster dagster \
 && mkdir -p ${DAGSTER_HOME}/storage \
 && chown -R dagster ${DAGSTER_HOME}
USER dagster

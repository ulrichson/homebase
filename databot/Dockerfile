FROM node:18

# TODO: split into builder and runtime stages

# USER root

RUN apt-get update && apt-get install -y --no-install-recommends \
    # build-essential 
    make \
    gcc \
    cron \
    python3\
    python3-pip \
    chromium

RUN groupadd -r appuser && useradd -rm -g appuser -G audio,video appuser

COPY --chown=appuser:appuser requirements.txt /app/
COPY --chown=appuser:appuser *.py /app
COPY --chown=appuser:appuser *.sh /app
COPY --chown=appuser:appuser *.json /app
COPY --chown=appuser:appuser *.ts /app
WORKDIR /app

# Install python dependencies
# RUN python3 -m pip3 install --upgrade pip
RUN pip3 install -r requirements.txt

# Install node dependencies and install
# RUN npm install -g n
# RUN n 18
RUN npm install
RUN npm run build
RUN npm install -g

# Permissions for cron job
RUN chmod 0644 /app/*.sh
RUN chmod +x /app/start.sh
RUN chmod +x /app/index.js
# RUN touch /var/run/crond.pid
# RUN chmod 777 /var/run/crond.pid

# Cron as non-root user
RUN chmod gu+rw /var/run
RUN chmod gu+s /usr/sbin/cron

# Load and render smartmeter data every 5 minutes
RUN crontab -l | { cat; echo "*/5 * * * * /bin/bash /app/cron_current.sh > /proc/1/fd/1 2>/proc/1/fd/2"; } | crontab -

# Archive charts weekly (at 00:00 on Thursday)
RUN crontab -l | { cat; echo "0 0 * * 4 /bin/bash /app/cron_archive.sh > /proc/1/fd/1 2>/proc/1/fd/2"; } | crontab -

USER appuser

CMD [ "/app/start.sh" ]
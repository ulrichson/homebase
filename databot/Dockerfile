FROM python:3.9-slim

RUN apt-get update && apt-get install -y \
    # build-essential 
    make \
    gcc \
    cron

COPY Pipfile Pipfile.lock /app/
COPY *.py /app/
COPY *.sh /app
WORKDIR /app
RUN python -m pip install --upgrade pip
RUN pip install pipenv && pipenv install
RUN chmod 0644 /app/*.sh
RUN chmod +x /app/start.sh

# Load and render smartmeter data every 5 minutes
RUN crontab -l | { cat; echo "*/5 * * * * /bin/bash /app/databot_cron.sh > /proc/1/fd/1 2>/proc/1/fd/2"; } | crontab -

CMD [ "/app/start.sh" ]
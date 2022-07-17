FROM python:3.9-alpine

COPY Pipfile Pipfile.lock /app/
COPY *.py /app/
WORKDIR /app
RUN python -m pip install --upgrade pip
RUN pip install pipenv && pipenv install

# Scrape smartmeter data every 5 minutes
RUN echo '*/5  *  *  *  *  cd /app && pipenv run python3 /app/main.py' > /etc/crontabs/root

# Run `crond -f` in foreground 
CMD [ "/usr/sbin/crond", "-f" ]
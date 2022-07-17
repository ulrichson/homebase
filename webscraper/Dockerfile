FROM python:3.9-alpine

COPY Pipfile Pipfile.lock /app/
COPY *.py /app/
WORKDIR /app
RUN python -m pip install --upgrade pip
RUN pip install pipenv && pipenv install
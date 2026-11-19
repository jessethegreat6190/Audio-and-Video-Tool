FROM php:8.2-cli-alpine

# Alpine's ffmpeg package includes x264/x265/AV1/VP9 and the common audio codecs.
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY . /app

RUN mkdir -p uploads outputs logs/pass jobs

EXPOSE 8080

# On non-Windows, config.php uses ffmpeg/ffprobe from PATH.
CMD ["php", "-S", "0.0.0.0:8080", "-t", "/app"]

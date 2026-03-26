# DEFAULT Dockerfile — intentionally insecure for demonstration purposes
# This Dockerfile uses the full node:18 image, which contains many OS-level
# packages with known CVEs. It also runs as root and has no health check.
# Trivy will flag this image and block it from reaching production.

FROM node:18

WORKDIR /app

COPY package.json .

RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]

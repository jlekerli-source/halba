FROM node:22-alpine

WORKDIR /app
COPY . .

ENV NODE_ENV=production
ENV PORT=4177
EXPOSE 4177

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4177/api/proof/bundle').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]

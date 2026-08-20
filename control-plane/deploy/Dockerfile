# 财听猫控制面后端 —— Go 服务镜像
# 多阶段构建：golang 编译 → distroless 运行

FROM golang:1.22-alpine AS builder
WORKDIR /src
# 先复制 go.mod/go.sum 以利用层缓存
COPY go.mod go.sum* ./
RUN go mod download || true
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/control-server ./cmd/server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata && adduser -D -u 10001 richcat
WORKDIR /app
COPY --from=builder /out/control-server /app/control-server
COPY web/dist /app/web
USER richcat
EXPOSE 8080
ENTRYPOINT ["/app/control-server"]

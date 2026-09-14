# Student mini-program boundary

微信小程序宿主目录。页面、AppSecret 和模型密钥尚未接入；客户端只允许调用 API 服务。

`src/protocol.ts` 是客户端与共享协议包的唯一边界；它不在小程序包内保存模型服务密钥。

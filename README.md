# Akutsu

## Clean web-ui based project manager for your homeserver

Ever wanted to clean up your cursed home server setup without relying on a ton of service files that shit themselves every 5 seconds?

> [!WARNING]
> Avoid running Akutsu on anything directly exposed to the web, while it does have an authentication system it is not meant to be on the public web.
> 


To install dependencies:

```bash
bun install
```

To run:

```bash
bun dev
```

To compile:

> [!NOTE]
> The executable literally includes everything you need, including html and font files!

```bash
bun package
```


All tools and code in this project are under the MIT license making this fully free.
The font is licensed under [SIL](https://openfontlicense.org/open-font-license-official-text/)
This project was created using `bun init` in Bun v1.3.5. [Bun](https://bun.com) is a fast, all-in-one JavaScript runtime.


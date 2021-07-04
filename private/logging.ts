

export type LogLevel = "error"|"warn"|"info"|"debug"|"trace"

// A logger with .log() methods that are compatible with console.log(...) signature.
export class Logger {
    // TODO: Set this from CLI args.
    level: LogLevel = "warn"

    log(...args: any[]) {
        console.log(...args)
    }

    error(...args: any[]) {
        if (this.levelNum < 1) { return }
        this.log("ERROR:", ...args)
    }
    warn(...args: any[]) {
        if (this.levelNum < 2) { return }
        this.log("WARN:", ...args)
    }

    info(...args: any[]) {
        if (this.levelNum < 3) { return }
        this.log("INFO:", ...args)
    }

    debug(...args: any[]) {
        if (this.levelNum < 4) { return }
        this.log("DEBUG:", ...args)
    }

    trace(...args: any[]) {
        if (this.levelNum < 5) { return }
        this.log("TRACE:", ...args)
    }

    async time<T>(message: string, callback: () => T) {
        let start = (new Date()).getMilliseconds()
        this.debug("TIME START:", message)
        try {
            return await callback()
        } finally {
            let end = (new Date()).getMilliseconds()
            let delta = end - start
            this.debug("TIME END:", message, "after", delta, "ms")
        }
    }
        

    private get levelNum() {
        switch(this.level) {
            case "error": return 1;
            case "warn": return 2;
            case "info": return 3;
            case "debug": return 4;
            case "trace": return 5;
        }
    }
}
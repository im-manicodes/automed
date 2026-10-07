import { Injectable } from '@nestjs/common';
import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { cpus, totalmem } from 'os';
import { AiSettingsService } from './ai-settings.service';
import { OllamaService } from './ollama.service';
import type { OllamaInfo } from './ollama.service';

export interface Gpu {
  nombre: string;
  vramGb: number;
}

export interface OllamaApto {
  apto: boolean;
  velocidad: 'rapida' | 'lenta' | null;
  motivo: string;
}

export interface HardwareInfo {
  entorno: 'docker' | 'local';
  ramGb: number;
  cpus: number;
  gpu?: Gpu;
  ollama: OllamaInfo;
  ollamaApto: OllamaApto;
}

export const MIN_RAM_GB = 8;
export const MIN_GPU_VRAM_GB = 4;

/** Regla pura: ¿puede este equipo correr un modelo local pequeño (qwen2.5vl:3b)? */
export function evaluarHardware(input: {
  ramGb: number;
  gpu?: Gpu;
  appleSilicon?: boolean;
}): OllamaApto {
  const { ramGb, gpu, appleSilicon } = input;
  if (ramGb < MIN_RAM_GB) {
    return {
      apto: false,
      velocidad: null,
      motivo: `Este equipo tiene ${ramGb} GB de memoria y el modelo local necesita al menos ${MIN_RAM_GB} GB. Usa un servicio en la nube.`,
    };
  }
  if (appleSilicon) {
    return {
      apto: true,
      velocidad: 'rapida',
      motivo: `Tu equipo Apple con ${ramGb} GB de memoria puede correr el modelo local con buena velocidad.`,
    };
  }
  if (gpu && gpu.vramGb >= MIN_GPU_VRAM_GB) {
    return {
      apto: true,
      velocidad: 'rapida',
      motivo: `Se detectó una tarjeta de video (${gpu.nombre}, ${gpu.vramGb} GB): el modelo local irá rápido.`,
    };
  }
  return {
    apto: true,
    velocidad: 'lenta',
    motivo: `Tu equipo tiene ${ramGb} GB de memoria pero no se detectó una tarjeta de video compatible: el modelo local funcionará, aunque lento.`,
  };
}

/** Interpreta la salida de `nvidia-smi --format=csv,noheader,nounits` (primera GPU). */
export function parseNvidiaSmi(out: string): Gpu | undefined {
  const line = out.split('\n').find((l) => l.trim());
  if (!line) return undefined;
  const i = line.lastIndexOf(',');
  if (i < 0) return undefined;
  const nombre = line.slice(0, i).trim();
  const mib = Number(line.slice(i + 1).trim());
  if (!nombre || !Number.isFinite(mib) || mib <= 0) return undefined;
  return { nombre, vramGb: Math.round((mib / 1024) * 10) / 10 };
}

@Injectable()
export class HardwareService {
  constructor(
    private readonly ai: AiSettingsService,
    private readonly ollama: OllamaService,
  ) {}

  private detectGpu(): Promise<Gpu | undefined> {
    return new Promise((resolve) => {
      try {
        execFile(
          'nvidia-smi',
          ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'],
          { timeout: 2000 },
          (err, stdout) => {
            if (err) return resolve(undefined);
            resolve(parseNvidiaSmi(String(stdout)));
          },
        );
      } catch {
        resolve(undefined);
      }
    });
  }

  private entorno(): 'docker' | 'local' {
    return existsSync('/.dockerenv') ||
      !!process.env.DOCKER ||
      !!process.env.KUBERNETES_SERVICE_HOST
      ? 'docker'
      : 'local';
  }

  async detect(): Promise<HardwareInfo> {
    const ramGb = Math.round((totalmem() / 1024 ** 3) * 10) / 10;
    const appleSilicon =
      process.platform === 'darwin' && process.arch === 'arm64';
    const [gpu, cfg] = await Promise.all([
      appleSilicon ? Promise.resolve(undefined) : this.detectGpu(),
      this.ai.getEffective(),
    ]);
    const ollama = await this.ollama.info(cfg.ollamaUrl);
    const info: HardwareInfo = {
      entorno: this.entorno(),
      ramGb,
      cpus: cpus().length,
      ollama,
      ollamaApto: evaluarHardware({ ramGb, gpu, appleSilicon }),
    };
    if (gpu) info.gpu = gpu;
    return info;
  }
}

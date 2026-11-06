import dotenv from "dotenv";
import express from "express";
import "global-jsdom/register";
import cluster from "cluster";
import os from "os";
import createServer from "./src/server.js";
import { installPrimaryHealthAggregator } from "./src/controllers/health-controller.js";
import { AggregatorRegistry } from "prom-client";
import fs from 'fs';

createPidFile();

dotenv.config();

const metricsServer = express();
const aggregatorRegistry = new AggregatorRegistry();

const numCPUs = os.cpus().length;
const desiredInstances = process.env.NB_THREADS
  ? parseInt(process.env.NB_THREADS)
  : numCPUs;
const metricsPort = process.env.METRICS_PORT || 3001;

if (cluster.isPrimary && desiredInstances > 1) {
  console.log(`msg="Launching ${desiredInstances} instances of the transformer"`);
  // Fork workers for each CPU core
  for (let i = 0; i < desiredInstances; i++) {
    cluster.fork();
  }
  installPrimaryHealthAggregator();
  cluster.on("exit", (worker: any, code: number, signal: any) => {
    console.log(`msg="Worker died" pid=${worker.process.pid}"`);
  });

  metricsServer.get("/metrics", async (req, res) => {
    try {
      const metrics = await aggregatorRegistry.clusterMetrics();
      res.set("Content-Type", aggregatorRegistry.contentType);
      res.send(metrics);
    } catch (e) {
      console.error(e);
      res.statusCode = 500;
      res.send("metrics.not.available");
    }
  });
  metricsServer.listen(metricsPort);
  console.log(
    `msg="Cluster metrics server listening to ${metricsPort}, metrics exposed on /metrics"`
  );
} else {
  createServer();
}
function createPidFile() {
  const path = process.env.PID_FILE;
  if(path) {
    if(fs.existsSync(path)) {
      console.log(`msg="Deleting old pid file" path=${path}`)
      fs.unlinkSync(path);
    }
    console.log(`msg="Writting pid file" path=${path}`)
    // Write PID file
    fs.writeFileSync(path, process.pid.toString(), { flag: 'w' });

    process.on('exit', () => {
      // Remove PID file on exit
      console.log(`msg="Removing olf pid file after exit" path=${path}`)
      fs.unlinkSync(path);
    });
  }
}


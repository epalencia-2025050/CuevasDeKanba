import { once } from 'node:events';
import { server } from '../../server/index.js';
if (!server.listening) await once(server, 'listening');
process.send({ port: server.address().port });

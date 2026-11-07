
const clients = new Set();

// Send an event to connected, authorized users.
function publishAttendanceChange(data) {
  const message = `event: attendance\ndata: ${JSON.stringify(data)}\n\n`;

  for (const client of clients) {
    const { user, response } = client;

    // Management receives attendance updates for all guards.
    // Guards receive updates only for their own attendance.
    const canReceive =
      user.role === 'admin' ||
      user.role === 'manager' ||
      Number(user.id) === Number(data.guard_id);

    if (!canReceive) continue;

    try {
      response.write(message);
    } catch (err) {
      clients.delete(client);
    }
  }
}
// Send shift updates to connected, authorized users.
function publishShiftChange(data) {
      console.log('SHIFT EVENT PUBLISH:', data, '| Connected clients:', clients.size);
  const message = `event: shift
data: ${JSON.stringify(data)}

`;

  for (const client of clients) {
    const { user, response } = client;

    // Management receives shift updates for all guards.
    // Guards receive updates only for their own shifts.
    const canReceive =
      user.role === 'admin' ||
      user.role === 'manager' ||
      Number(user.id) === Number(data.guard_id);

    if (!canReceive) continue;

    try {
      response.write(message);
    } catch (err) {
      clients.delete(client);
    }
  }
}

// Establish a persistent SSE connection.
function connect(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  res.flushHeaders();

  const client = {
    user: req.user,
    response: res
  };

  clients.add(client);
    console.log('SSE CLIENT CONNECTED:', req.user.role, '| Total clients:', clients.size);

  res.write('event: connected\ndata: {"success":true}\n\n');

    res.on('close', () => {
    clients.delete(client);
  });

  res.on('error', () => {
    clients.delete(client);
  });
}

// Keep connections alive through proxies.
const heartbeat = setInterval(() => {
  for (const client of clients) {
    try {
      client.response.write(': heartbeat\n\n');
    } catch (err) {
      clients.delete(client);
    }
  }
}, 25000);

heartbeat.unref();

module.exports = {
  connect,
  publishAttendanceChange,
  publishShiftChange
};

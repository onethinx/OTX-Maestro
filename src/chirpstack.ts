import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';
import * as io from './fileio';

// Define the configuration interface
export interface ChirpStackConfig {
    protocol: 'rest' | 'grpc';
    url: string; // For REST include protocol (e.g. "http://example.com") and for gRPC, use "host:port" (e.g. "example.com:8080")
    encryptedApiKey: string;
    tenantId: string;
    deviceProfileId: string;
    applicationId: string;
}
  
// Define the default configuration
export const defaultChirpStackConfig: ChirpStackConfig = {
    protocol: 'rest',
    url: '',
    encryptedApiKey: '',
    tenantId: '',
    deviceProfileId: '',
    applicationId: ''
};
  
  // You can export other chirpstack functions or endpoints here if needed.
export let config = { ...defaultChirpStackConfig };
let protoDescriptor: any;
export let settingsChanged = false;

// Initialization function to set configuration
export function init(newConfig: ChirpStackConfig): void {
	config = newConfig;
    settingsChanged = false;
    if (config.protocol === 'grpc') {
        const protoFiles = [
            path.join(__dirname, '../src/proto/chirpstack/api/device.proto'),
            path.join(__dirname, '../src/proto/chirpstack/api/application.proto'),
            path.join(__dirname, '../src/proto/chirpstack/api/tenant.proto'),
            path.join(__dirname, '../src/proto/chirpstack/api/device_profile.proto'),
            path.join(__dirname, '../src/proto/chirpstack/common/common.proto'),
            path.join(__dirname, '../src/proto/google/api/annotations.proto'),
            path.join(__dirname, '../src/proto/google/api/http.proto')
        ];
        const packageDefinition = protoLoader.loadSync(protoFiles, {
            keepCase: false,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs: [path.join(__dirname, '../src/proto')]
        });
        protoDescriptor =  grpc.loadPackageDefinition(packageDefinition) as any;
    }
}

export function updateSetting<K extends keyof ChirpStackConfig>(key: K, value: ChirpStackConfig[K]): void {
    if (config[key] === value) return;
    settingsChanged = true;
    config[key] = value;
    
    try {
        if (key === 'protocol' || key === 'url') {
            if (config.protocol === 'grpc') {
                config.url = ((u: string) => /:\d+$/.test(u) ? u : u + ':8080')(
                    (config.url as string).replace(/^https?:\/\//, '').replace(/\/$/, '')
                );
            } else { // REST
                config.url = ((u: string) => /:\d+($|\/)/.test(u) ? u : u + ':8090')(
                    ((u: string) => /^https?:\/\//.test(u) ? u : 'http://' + u)(
                        (config.url as string).replace(/\/$/, '')
                    )
                );
            }
        }
    } catch (e) { console.error(e); }
}

// ---------------------------------------------------------------------------
// REST Endpoints Implementation
// ---------------------------------------------------------------------------
const restEndpoints = {
    getTenants: async (): Promise<any> => {
        const endpoint = `${config.url}/api/tenants?limit=50`;
        const rawData = await io.sendHttpRequest(endpoint, 'GET', {
          'Authorization': `Bearer ${config.encryptedApiKey}`
        });
        return JSON.parse(rawData);
    },

    getApplications: async (tenantId: string): Promise<any> => {
        const endpoint = `${config.url}/api/applications?tenantId=${tenantId}&limit=50`;
        const rawData = await io.sendHttpRequest(endpoint, 'GET', {
          'Authorization': `Bearer ${config.encryptedApiKey}`
        });
        return JSON.parse(rawData);
    },
    
    getDeviceProfiles: async (tenantId: string): Promise<any> => {
        const endpoint = `${config.url}/api/device-profiles?tenantId=${tenantId}&limit=50`;
        const rawData = await io.sendHttpRequest(endpoint, 'GET', {
          'Authorization': `Bearer ${config.encryptedApiKey}`
        });
        return JSON.parse(rawData);
    },

	getDevice: async (devEui: string): Promise<any> => {
		const endpoint = `${config.url}/api/devices/${devEui}`;
		const rawData = await io.sendHttpRequest(endpoint, 'GET', {
			'Authorization': `Bearer ${config.encryptedApiKey}`
		});
        return JSON.parse(rawData);
	},

    deleteDevice: async (devEui: string): Promise<any> => {
        const endpoint = `${config.url}/api/devices/${devEui}`;
        const rawData = await io.sendHttpRequest(endpoint, 'DELETE', {
            'Authorization': `Bearer ${config.encryptedApiKey}`
        });
        return JSON.parse(rawData);
    },

	createDevice: async (request: any): Promise<any> => {
		const endpoint = `${config.url}/api/devices`;
		const jsonRequest = JSON.stringify(request);
		const rawData = await io.sendHttpRequest(endpoint, 'POST', {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${config.encryptedApiKey}`
		}, jsonRequest);
	},

    setDeviceKeys: async (devEui: string, request: any): Promise<any> => {
        const endpoint = `${config.url}/api/devices/${devEui}/keys`;
        const jsonRequest = JSON.stringify(request);
        const rawData = await io.sendHttpRequest(endpoint, 'POST', {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.encryptedApiKey}`
        }, jsonRequest);
        return JSON.parse(rawData);
    }
};

// ---------------------------------------------------------------------------
// gRPC Endpoints Implementation
// ---------------------------------------------------------------------------

const grpcEndpoints = {
    getTenants: async (): Promise<any> => {
        const TenantService = protoDescriptor.api.TenantService;
        const client = new TenantService(config.url, grpc.credentials.createInsecure());
        const metadata = new grpc.Metadata();
        metadata.add('authorization', `Bearer ${config.encryptedApiKey}`);
        const request = { limit: 50 };
        return new Promise((resolve, reject) => {
            client.List(request, metadata, (err: any, response: any) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
    },

    getApplications: async (tenantId: string): Promise<any> => {
        const ApplicationService = protoDescriptor.api.ApplicationService;
        const client = new ApplicationService(config.url, grpc.credentials.createInsecure());
        const metadata = new grpc.Metadata();
        metadata.add('authorization', `Bearer ${config.encryptedApiKey}`);
        const request = { tenantId: tenantId, limit: 50 };
        return new Promise((resolve, reject) => {
            client.List(request, metadata, (err: any, response: any) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
    },

    getDeviceProfiles: async (tenantId: string): Promise<any> => {
        const DeviceProfileService = protoDescriptor.api.DeviceProfileService;
        const client = new DeviceProfileService(config.url, grpc.credentials.createInsecure());
        const metadata = new grpc.Metadata();
        metadata.add('authorization', `Bearer ${config.encryptedApiKey}`);
        const request = { tenantId: tenantId, limit: 50 };
        return new Promise((resolve, reject) => {
            client.List(request, metadata, (err: any, response: any) => {
                if (err) reject(err);
                else resolve(response);
            });
        });
    },

	getDevice: async (devEui: string): Promise<any> => {
		const DeviceService = protoDescriptor.api.DeviceService;
		const client = new DeviceService(config.url, grpc.credentials.createInsecure());
		const metadata = new grpc.Metadata();
		metadata.add('authorization', `Bearer ${config.encryptedApiKey}`);
		const request = { devEui: devEui };
		return new Promise((resolve, reject) => {
			client.Get(request, metadata, (err: any, response: any) => {
				if (err) reject(err);
				else resolve(response);
			});
		});
	},

    deleteDevice: async (devEui: string): Promise<any> => {
		const DeviceService = protoDescriptor.api.DeviceService;
		const client = new DeviceService(config.url, grpc.credentials.createInsecure());
		const metadata = new grpc.Metadata();
		metadata.add('authorization', `Bearer ${config.encryptedApiKey}`);
		const request = { devEui: devEui };
		return new Promise((resolve, reject) => {
			client.Delete(request, metadata, (err: any, response: any) => {
				if (err) reject(err);
				else resolve(response);
			});
		});
    },

	createDevice: async (request: any): Promise<any> => {
		const DeviceService = protoDescriptor.api.DeviceService;
		const client = new DeviceService(config.url, grpc.credentials.createInsecure());
		const metadata = new grpc.Metadata();
		metadata.add('authorization', `Bearer ${config.encryptedApiKey}`);
		return new Promise((resolve, reject) => {
			client.Create(request, metadata, (err: any, response: any) => {
				if (err) reject(err);
				else resolve(response);
			});
		});
	},

    setDeviceKeys: async (devEui: string, request: any): Promise<any> => {
        const DeviceService = protoDescriptor.api.DeviceService;
		const client = new DeviceService(config.url, grpc.credentials.createInsecure());
		const metadata = new grpc.Metadata();
		metadata.add('authorization', `Bearer ${config.encryptedApiKey}`);
		return new Promise((resolve, reject) => {
			client.CreateKeys(request, metadata, (err: any, response: any) => {
				if (err) reject(err);
				else resolve(response);
			});
		});
    }
};

// ---------------------------------------------------------------------------
// Unified Interface for Device API Calls
// ---------------------------------------------------------------------------

export const getTenants: () => Promise<any> = () => {
    switch (config.protocol) {
      case 'rest':
        return restEndpoints.getTenants();
      case 'grpc':
        return grpcEndpoints.getTenants();
      default:
        return Promise.reject(new Error(`Unsupported protocol: ${config.protocol}`));
    }
};

export const getApplications: (tenantId: string) => Promise<any> = (tenantId: string) => {
    switch (config.protocol) {
      case 'rest':
        return restEndpoints.getApplications(tenantId);
      case 'grpc':
        return grpcEndpoints.getApplications(tenantId);
      default:
        return Promise.reject(new Error(`Unsupported protocol: ${config.protocol}`));
    }
};

export const getDeviceProfiles: (tenantId: string) => Promise<any> = (tenantId: string) => {
    switch (config.protocol) {
      case 'rest':
        return restEndpoints.getDeviceProfiles(tenantId);
      case 'grpc':
        return grpcEndpoints.getDeviceProfiles(tenantId);
      default:
        return Promise.reject(new Error(`Unsupported protocol: ${config.protocol}`));
    }
}

export const getDevice: (devEui: string) => Promise<any> = (devEui: string) => {
    switch (config.protocol) {
      case 'rest':
        return restEndpoints.getDevice(devEui);
      case 'grpc':
        return grpcEndpoints.getDevice(devEui);
      default:
        return Promise.reject(new Error(`Unsupported protocol: ${config.protocol}`));
    }
};

export const deleteDevice: (devEui: string) => Promise<any> = (devEui: string) => {
    switch (config.protocol) {
      case 'rest':
        return restEndpoints.deleteDevice(devEui);
      case 'grpc':
        return grpcEndpoints.deleteDevice(devEui);
      default:
        return Promise.reject(new Error(`Unsupported protocol: ${config.protocol}`));
    }
};
  
export const createDevice: (device: any) => Promise<any> = (device: any) => {
    const createDeviceRequest = {
		device: device
    };
    switch (config.protocol) {
        case 'rest':
            return restEndpoints.createDevice(createDeviceRequest);
        case 'grpc':
            return grpcEndpoints.createDevice(createDeviceRequest);
        default:
            return Promise.reject(new Error(`Unsupported protocol: ${config.protocol}`));
    }
};
  
export const setDeviceKeys: (devEui: string, nwkKey: string) => Promise<any> = (devEui: string, nwkKey: string) => {
    const setKeyRequest = {
        deviceKeys: {
            devEui: devEui,
            nwkKey: nwkKey
        }
    };
    switch (config.protocol) {
        case 'rest':
            return restEndpoints.setDeviceKeys(devEui, setKeyRequest);
        case 'grpc':
            return grpcEndpoints.setDeviceKeys(devEui, setKeyRequest);
        default:
            return Promise.reject(new Error(`Unsupported protocol: ${config.protocol}`));
    }
};
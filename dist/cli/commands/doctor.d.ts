export interface DoctorOptions {
    readonly templatesRoot?: string;
    readonly fix?: boolean;
}
export declare function runDoctor(target: string, opts?: DoctorOptions): Promise<number>;

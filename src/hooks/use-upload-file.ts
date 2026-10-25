import {useState,useCallback} from 'react';
import {toast} from 'sonner';
export interface UploadedFile {name:string;url:string;size:number;type:string;key:string}
/** Local media persistence. No fake uploads and no third-party service. */
export function useUploadFile(){
  const [uploadedFile,setUploadedFile]=useState<UploadedFile>();
  const [uploadingFile,setUploadingFile]=useState<File>();
  const [progress,setProgress]=useState(0);
  const uploadFile=useCallback(async(file:File)=>{
    setUploadingFile(file);setProgress(0);
    try{
      if(file.size>2*1024*1024)throw Error('本地草稿支持 2 MB 以下的附件；较大的媒体请使用 URL。');
      const url=await new Promise<string>((resolve,reject)=>{
        const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);
      });
      const result={name:file.name,url,size:file.size,type:file.type,key:crypto.randomUUID()};setUploadedFile(result);setProgress(100);return result;
    }catch(error){showErrorToast(error);}finally{setUploadingFile(undefined);}
  },[]);
  return {uploadedFile,uploadingFile,progress,isUploading:!!uploadingFile,uploadFile};
}
export function getErrorMessage(error:unknown){return error instanceof Error?error.message:'无法添加文件';}
export function showErrorToast(error:unknown){return toast.error(getErrorMessage(error));}
